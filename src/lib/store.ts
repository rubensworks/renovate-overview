import { NothingToDoError, backoffFor, mergeMethodFor, runAction } from './actions';
import type { GitHubClient } from './githubClient';
import { asHttpError, describeError } from './githubClient';
import type { ISearchScope } from './search';
import {
  PAGE_SIZE,
  SEARCH_CEILING,
  applyChecks,
  applyDetail,
  authorsFor,
  buildSearchQuery,
  describeScope,
  mergePrs,
  normalizeSearchItem,
  planSearches,
  reviewDecisionFrom,
  splitScope,
} from './search';
import type {
  ActionKind,
  IActionResult,
  IDashboardState,
  IOwnerToken,
  IRenovatePr,
  ISettings,
  IRateLimit,
  ITruncatedScope,
  MergeMethod,
} from './types';

/**
 * A run of pages is stopped here so that one runaway search cannot spend the whole GraphQL quota.
 */
const MAX_PAGES = 40;

/**
 * How many pull requests are enriched at once.
 *
 * The search says which pull requests exist but not what state they are in, so each one needs a
 * couple of requests of its own. Doing a handful at a time keeps rows filling in steadily
 * without opening dozens of connections at once.
 */
export const ENRICH_BATCH_SIZE = 6;

/**
 * How many failures in a row before the queue gives up.
 *
 * A bulk merge that is failing on every pull request is failing for a reason that the next one
 * will hit too — a missing permission, a branch protection rule — and hammering the API with the
 * rest of the list helps nobody.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * How often the whole search is re-run, and how often the pull requests whose checks are still
 * running are re-read over REST. Pending ones move; settled ones mostly do not.
 */
export const IDLE_POLL_MS = 120_000;
export const PENDING_POLL_MS = 30_000;

/**
 * The scheduler wakes up this often and decides what, if anything, is due.
 */
export const TICK_MS = 2000;

/**
 * How many pending pull requests are re-read per tick, so a backlog of two hundred running checks
 * does not become two hundred simultaneous requests.
 */
const PENDING_BATCH = 5;

/**
 * What to try next when a repository refuses a merge method. Squash is the most commonly allowed,
 * so anything else falls back to it and squash falls back to a merge commit.
 */
const MERGE_FALLBACKS: Record<MergeMethod, MergeMethod> = {
  squash: 'merge',
  merge: 'squash',
  rebase: 'squash',
};

/**
 * Polling slows by this factor once the GraphQL quota drops below {@link LOW_QUOTA_RATIO}, and
 * stops entirely below {@link CRITICAL_QUOTA_RATIO} so that a manual refresh still has room.
 */
const LOW_QUOTA_FACTOR = 5;
const LOW_QUOTA_RATIO = 0.15;
const CRITICAL_QUOTA_RATIO = 0.03;

export const INITIAL_STATE: IDashboardState = {
  prs: [],
  loading: false,
  error: undefined,
  bodyError: undefined,
  selected: [],
  droppedFromSelection: 0,
  actionRun: undefined,
  searchRateLimit: undefined,
  paused: false,
  backoffUntil: undefined,
  backoffReason: undefined,
  totalCount: 0,
  rateLimit: undefined,
  lastRefreshedAt: undefined,
  truncated: [],
};

interface IScopeResult {
  issueCount: number;
  truncated: ITruncatedScope | undefined;
}

/**
 * Owns the pull request data and exposes an immutable snapshot for `useSyncExternalStore`.
 *
 * Pages are published as they arrive rather than at the end, because the first fifty rows are
 * useful long before the last page of a several-hundred-pull-request backlog lands.
 */
export class DashboardStore {
  private readonly client: GitHubClient;
  private readonly listeners = new Set<() => void>();
  private state: IDashboardState = INITIAL_STATE;
  private settings: ISettings;
  private ownerTokens: IOwnerToken[];
  private readonly onSettingsChange: ((settings: ISettings) => void) | undefined;
  private readonly viewerLogin: string;
  private readonly reviewsInFlight = new Set<string>();
  private ticker: ReturnType<typeof setInterval> | undefined;
  private readonly onVisibilityChange: () => void;
  /**
   * When the whole search was last re-run, and when each pending pull request's checks were last
   * re-read, both as Unix timestamps in milliseconds.
   */
  private lastFullPoll = 0;
  private readonly pendingPolledAt = new Map<string, number>();
  private polling = false;
  /**
   * Bumped on every refresh, so a slow page from a superseded run cannot overwrite a newer one.
   */
  private generation = 0;

  public constructor(
    client: GitHubClient,
    viewerLogin: string,
    settings: ISettings,
    ownerTokens: IOwnerToken[],
    onSettingsChange?: (settings: ISettings) => void,
  ) {
    this.client = client;
    this.onSettingsChange = onSettingsChange;
    this.viewerLogin = viewerLogin;
    this.settings = settings;
    this.ownerTokens = ownerTokens;
    this.onVisibilityChange = () => {
      this.patch({ paused: document.hidden });
    };
  }

  /**
   * Starts polling: a full search every couple of minutes, and the pull requests whose checks are
   * still running every half minute over REST.
   *
   * Nothing polls while the tab is hidden. A dashboard nobody is looking at has no business
   * spending anybody's rate limit.
   */
  public start(): void {
    if (this.ticker !== undefined) {
      return;
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.patch({ paused: document.hidden });
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): IDashboardState => this.state;

  /**
   * Replaces the settings a refresh will be built from.
   *
   * The data on screen is left alone: which accounts and bots to search is only consulted when a
   * refresh actually runs, so changing it does not blank the dashboard.
   * @param settings The new settings.
   * @param ownerTokens The new per-owner tokens.
   */
  public configure(settings: ISettings, ownerTokens: IOwnerToken[]): void {
    this.settings = settings;
    this.ownerTokens = ownerTokens;
  }

  /**
   * Stops anything still scheduled. Called when the store is replaced or the app unmounts.
   */
  public dispose(): void {
    this.generation += 1;
    if (this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  // One low-frequency ticker decides what is due, rather than a timer per thing being polled.
  private tick(): void {
    const now = Date.now();
    if (this.state.paused || this.polling || this.state.loading) {
      return;
    }
    if (this.state.backoffUntil !== undefined) {
      if (now < this.state.backoffUntil) {
        return;
      }
      this.patch({ backoffUntil: undefined, backoffReason: undefined });
    }

    const ratio = quotaRatio(this.state.rateLimit);
    if (ratio < CRITICAL_QUOTA_RATIO) {
      // Stopping short of zero leaves room for a manual refresh, and says so rather than just
      // going quiet.
      this.patch({
        backoffUntil: now + IDLE_POLL_MS,
        backoffReason: 'GraphQL quota nearly spent — polling paused',
      });
      return;
    }
    const slowdown = ratio < LOW_QUOTA_RATIO ? LOW_QUOTA_FACTOR : 1;

    let job: Promise<void> | undefined;
    if (now - this.lastFullPoll >= IDLE_POLL_MS * slowdown) {
      this.lastFullPoll = now;
      job = this.refresh();
    } else {
      const due = this.state.prs
        .filter(pr => pr.checkState === 'pending')
        .filter(pr => now - (this.pendingPolledAt.get(pr.id) ?? 0) >= PENDING_POLL_MS * slowdown)
        .slice(0, PENDING_BATCH);
      if (due.length > 0) {
        job = this.pollChecks(due);
      }
    }

    if (job === undefined) {
      return;
    }
    this.polling = true;
    // Both of those record their own failures in the state and always resolve, so there is
    // nothing to handle here beyond letting the scheduler know it is free again.
    // eslint-disable-next-line ts/no-floating-promises
    job.finally(() => {
      this.polling = false;
    });
  }

  /**
   * Re-reads the checks of pull requests that were still running.
   *
   * Conditional, so a `304` for a pull request nothing has happened to is free — which is what
   * makes a thirty-second interval affordable for the handful that are actually moving.
   * @param prs The pull requests to re-read.
   */
  public async pollChecks(prs: IRenovatePr[]): Promise<void> {
    const generation = this.generation;
    const updates = new Map<string, IRenovatePr>();

    for (const pr of prs) {
      // Jittered so that a batch does not arrive as a burst, and so two tabs do not sync up.
      this.pendingPolledAt.set(pr.id, Date.now() + Math.floor(Math.random() * PENDING_POLL_MS * 0.3));
      const [ owner, name ] = splitRepo(pr.repo);
      try {
        const checkRuns = await this.client.getCheckRuns(owner, name, pr.headSha);
        if (this.generation !== generation) {
          return;
        }
        if (checkRuns.notModified) {
          continue;
        }
        const status = await this.client.getCombinedStatus(owner, name, pr.headSha)
          .catch((): undefined => undefined);
        if (this.generation !== generation) {
          return;
        }
        updates.set(pr.id, applyChecks(pr, checkRuns.runs, status));
      } catch (error: unknown) {
        if (this.generation !== generation) {
          return;
        }
        const backoff = backoffFor(error);
        if (backoff !== undefined) {
          this.patch({
            backoffUntil: Date.now() + backoff,
            backoffReason: 'GitHub asked us to slow down',
          });
          break;
        }
        // A single repository the token cannot read the checks of is not worth a banner.
      }
    }

    this.patch({
      prs: updates.size === 0 ?
        this.state.prs :
        this.state.prs.map(pr => updates.get(pr.id) ?? pr),
      rateLimit: this.client.rateLimit,
    });
  }

  /**
   * Fetches every configured scope, publishing rows as each page arrives, then fills in the
   * detail each row needs to be judged.
   */
  public async refresh(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;

    this.patch({ loading: true, error: undefined, truncated: []});

    const authors = authorsFor(this.settings);
    const groups: IRenovatePr[][] = [];
    const truncated: ITruncatedScope[] = [];
    let totalCount = 0;

    try {
      for (const scope of planSearches(this.viewerLogin, this.settings.orgs, this.ownerTokens)) {
        // A combined scope that hits the ceiling is retried one owner at a time, which is the
        // only lever available: the ceiling is per result set, not per account.
        const result = await this.fetchScope(scope, authors, generation, groups, totalCount);
        if (this.generation !== generation) {
          return;
        }
        totalCount += result.issueCount;
        if (result.truncated !== undefined && scope.owners.length > 1) {
          groups.pop();
          totalCount -= result.issueCount;
          for (const single of splitScope(scope)) {
            const retried = await this.fetchScope(single, authors, generation, groups, totalCount);
            if (this.generation !== generation) {
              return;
            }
            totalCount += retried.issueCount;
            if (retried.truncated !== undefined) {
              truncated.push(retried.truncated);
            }
          }
        } else if (result.truncated !== undefined) {
          truncated.push(result.truncated);
        }
      }
    } catch (error: unknown) {
      if (this.generation === generation) {
        this.patch({ loading: false, error: describeError(error) });
      }
      return;
    }

    const prs = mergePrs(groups);
    const alive = new Set(prs.map(pr => pr.id));
    const keptSelection = this.state.selected.filter(id => alive.has(id));
    this.patch({
      prs,
      selected: keptSelection,
      droppedFromSelection: this.state.selected.length - keptSelection.length,
      totalCount,
      truncated,
      lastRefreshedAt: Date.now(),
      rateLimit: this.client.rateLimit,
      searchRateLimit: this.client.searchRateLimit,
    });
    this.lastFullPoll = Date.now();

    // The rows are on screen; now find out what state each of them is actually in.
    await this.enrich(prs, generation);
    if (this.generation === generation) {
      this.patch({ loading: false });
    }
  }

  private async fetchScope(
    scope: ISearchScope,
    authors: string[],
    generation: number,
    groups: IRenovatePr[][],
    countSoFar: number,
  ): Promise<IScopeResult> {
    const query = buildSearchQuery(scope, authors);
    const collected: IRenovatePr[] = [];
    // Published progressively, so this slot is claimed before the first page arrives.
    const slot = groups.push(collected) - 1;
    let issueCount = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await this.client.searchPrs(query, page, PAGE_SIZE, scope.tokenOwner);
      if (this.generation !== generation) {
        return { issueCount: 0, truncated: undefined };
      }
      issueCount = response.total_count ?? 0;
      const items = response.items ?? [];
      for (const item of items) {
        const pr = normalizeSearchItem(item ?? null);
        if (pr !== undefined) {
          collected.push(pr);
        }
      }
      groups[slot] = collected;
      this.patch({
        prs: mergePrs(groups),
        totalCount: countSoFar + issueCount,
        rateLimit: this.client.rateLimit,
        searchRateLimit: this.client.searchRateLimit,
      });

      if (items.length < PAGE_SIZE || collected.length >= issueCount) {
        break;
      }
    }

    // GitHub reports the true match count but hands over at most SEARCH_CEILING of them, so a
    // count at or above the ceiling means rows are missing, not merely numerous.
    const truncated = issueCount >= SEARCH_CEILING ?
        { label: describeScope(scope), count: issueCount } :
      undefined;
    return { issueCount, truncated };
  }

  /**
   * Fills in what the search could not say: the head commit, the branch, the mergeability and
   * the checks.
   *
   * Rows are published as each batch lands, so a long list settles from the top rather than
   * appearing all at once at the end.
   * @param prs The pull requests to enrich.
   * @param generation The refresh this belongs to.
   */
  private async enrich(prs: IRenovatePr[], generation: number): Promise<void> {
    for (let start = 0; start < prs.length; start += ENRICH_BATCH_SIZE) {
      const batch = prs.slice(start, start + ENRICH_BATCH_SIZE);
      const enriched = await Promise.all(batch.map(async pr => this.enrichOne(pr)));
      if (this.generation !== generation) {
        return;
      }
      const byId = new Map(enriched.map(pr => [ pr.id, pr ]));
      this.patch({
        prs: this.state.prs.map(pr => byId.get(pr.id) ?? pr),
        rateLimit: this.client.rateLimit,
      });
    }
  }

  // One pull request's detail and checks. A failure leaves the row as the search drew it rather
  // than losing it: a repository whose checks the token cannot read is still a pull request.
  private async enrichOne(pr: IRenovatePr): Promise<IRenovatePr> {
    const [ owner, name ] = splitRepo(pr.repo);
    let next = pr;
    try {
      next = applyDetail(pr, await this.client.getPr(owner, name, pr.number));
    } catch {
      return { ...pr, detailLoaded: true };
    }
    if (next.headSha.length === 0) {
      return next;
    }
    try {
      const [ runs, status ] = await Promise.all([
        this.client.getCheckRuns(owner, name, next.headSha),
        this.client.getCombinedStatus(owner, name, next.headSha).catch((): undefined => undefined),
      ]);
      next = applyChecks(next, runs.runs, status);
    } catch {
      // Left with no checks, which reads as "no checks" — the same as a commit that has none.
    }
    return next;
  }

  /**
   * Reads the review decision of one pull request.
   *
   * REST has no bulk equivalent of GraphQL's `reviewDecision`, so this costs a request per pull
   * request and is only spent on the one whose row has been opened.
   * @param id A pull request id.
   */
  public async loadReviewDecision(id: string): Promise<void> {
    const generation = this.generation;
    const pr = this.state.prs.find(entry => entry.id === id);
    if (pr === undefined || this.reviewsInFlight.has(id)) {
      return;
    }
    this.reviewsInFlight.add(id);
    const [ owner, name ] = splitRepo(pr.repo);
    try {
      const decision = reviewDecisionFrom(await this.client.getReviews(owner, name, pr.number));
      if (this.generation !== generation) {
        return;
      }
      this.patch({
        prs: this.state.prs.map(entry => (entry.id === id ? { ...entry, reviewDecision: decision } : entry)),
        rateLimit: this.client.rateLimit,
      });
    } catch {
      // A review decision is an enrichment; a row without one is still perfectly usable.
    } finally {
      this.reviewsInFlight.delete(id);
    }
  }

  /**
   * Replaces the selection.
   * @param ids The pull request ids to select.
   */
  public setSelection(ids: string[]): void {
    const known = new Set(this.state.prs.map(pr => pr.id));
    this.patch({ selected: [ ...new Set(ids) ].filter(id => known.has(id)), droppedFromSelection: 0 });
  }

  /**
   * Adds or removes one pull request from the selection.
   * @param id A pull request id.
   */
  public toggleSelection(id: string): void {
    const selected = this.state.selected.includes(id) ?
      this.state.selected.filter(entry => entry !== id) :
        [ ...this.state.selected, id ];
    this.setSelection(selected);
  }

  /**
   * Forgets the last action's progress list.
   */
  public clearActionRun(): void {
    this.patch({ actionRun: undefined });
  }

  /**
   * Runs one action over some pull requests, one at a time.
   *
   * Sequential on purpose: GitHub's secondary rate limits punish concurrent writes to the same
   * repository, and a queue that stops after a few failures is far kinder than one that works
   * through two hundred pull requests failing the same way.
   * @param kind The action.
   * @param prs The pull requests to act on, in the order they should be attempted.
   */
  public async runActions(kind: ActionKind, prs: IRenovatePr[]): Promise<void> {
    const generation = this.generation;
    // Each pull request is paired with its own result object, which is then updated in place —
    // indexing back into the list would need a bounds check that could never fail.
    const queue = prs.map(pr => ({
      pr,
      result: <IActionResult>{
        prId: pr.id,
        label: `${pr.repo}#${pr.number}`,
        outcome: 'pending',
        message: undefined,
      },
    }));
    const results = queue.map(entry => entry.result);
    this.patch({ actionRun: { kind, results, running: true, stoppedReason: undefined }});

    const touched: IRenovatePr[] = [];
    let consecutiveFailures = 0;
    let stoppedReason: string | undefined;

    for (const [ index, { pr, result }] of queue.entries()) {
      if (this.generation !== generation) {
        return;
      }
      this.updateResult(kind, results, result, { outcome: 'running' });
      try {
        await runAction(this.client, kind, pr, this.settings);
        consecutiveFailures = 0;
        touched.push(pr);
        this.updateResult(kind, results, result, { outcome: 'succeeded' });
      } catch (error: unknown) {
        // Nothing to do is not a failure, and must not count towards giving up.
        if (error instanceof NothingToDoError) {
          this.updateResult(kind, results, result, { outcome: 'skipped', message: error.message });
          continue;
        }
        consecutiveFailures += 1;
        this.updateResult(kind, results, result, { outcome: 'failed', message: describeError(error) });
        this.rememberMergeRefusal(kind, pr, error);

        const backoff = backoffFor(error);
        if (backoff !== undefined) {
          stoppedReason = `GitHub asked us to slow down; stopped after ${index + 1} of ${prs.length}`;
          break;
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stoppedReason =
            `Stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row — something is wrong for all of them`;
          break;
        }
      }
    }

    if (this.generation !== generation) {
      return;
    }
    this.patch({ actionRun: { kind, results, running: false, stoppedReason }});
    // Only the pull requests that actually changed are re-read, rather than the whole search.
    await this.refreshPrs(touched, generation);
  }

  // A 405 on a merge means the repository forbids the method, not that the merge was wrong. The
  // next method it allows is remembered for that repository, so a retry is one click rather than
  // a trip through the settings.
  private rememberMergeRefusal(kind: ActionKind, pr: IRenovatePr, error: unknown): void {
    if (kind !== 'merge' || asHttpError(error)?.status !== 405 || this.onSettingsChange === undefined) {
      return;
    }
    const key = pr.repo.toLowerCase();
    // Only ever set once. Deriving a new fallback from the override just set would flip the
    // repository back and forth between two methods on every retry.
    if (this.settings.repoMergeMethods[key] !== undefined) {
      return;
    }
    const fallback = MERGE_FALLBACKS[mergeMethodFor(pr.repo, this.settings)];
    const next: ISettings = {
      ...this.settings,
      repoMergeMethods: { ...this.settings.repoMergeMethods, [key]: fallback },
    };
    this.settings = next;
    this.onSettingsChange(next);
  }

  // A write changes one pull request, so re-reading just that one brings it back up to date.
  // Re-running the whole search would cost far more and would still lag the index by seconds.
  private async refreshPrs(prs: IRenovatePr[], generation: number): Promise<void> {
    const gone: string[] = [];
    const updated = new Map<string, IRenovatePr>();

    for (const pr of prs) {
      const [ owner, name ] = splitRepo(pr.repo);
      try {
        const detail = await this.client.getPr(owner, name, pr.number);
        if (this.generation !== generation) {
          return;
        }
        // A pull request that has been merged or closed is no longer part of the backlog.
        if (detail.state !== undefined && detail.state !== 'open') {
          gone.push(pr.id);
        } else {
          updated.set(pr.id, applyDetail(pr, detail));
        }
      } catch {
        // The writes already reported their own outcome; a stale row is a small price next to an
        // error message about a refresh nobody asked for.
      }
    }

    if (this.generation !== generation || (gone.length === 0 && updated.size === 0)) {
      return;
    }
    this.patch({
      prs: this.state.prs.filter(pr => !gone.includes(pr.id)).map(pr => updated.get(pr.id) ?? pr),
      rateLimit: this.client.rateLimit,
    });
    this.setSelection(this.state.selected);
  }

  private updateResult(
    kind: ActionKind,
    results: IActionResult[],
    result: IActionResult,
    patch: Partial<IActionResult>,
  ): void {
    Object.assign(result, patch);
    this.patch({
      actionRun: { kind, results: results.map(entry => ({ ...entry })), running: true, stoppedReason: undefined },
    });
  }

  private patch(next: Partial<IDashboardState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function splitRepo(repo: string): [string, string] {
  const slash = repo.indexOf('/');
  return [ repo.slice(0, Math.max(0, slash)), repo.slice(slash + 1) ];
}

/**
 * The REST quota, as a fraction of its limit, or 1 when it is not known yet.
 * @param rateLimit A rate limit.
 */
export function quotaRatio(rateLimit: IRateLimit | undefined): number {
  return rateLimit === undefined ? 1 : rateLimit.remaining / Math.max(1, rateLimit.limit);
}
