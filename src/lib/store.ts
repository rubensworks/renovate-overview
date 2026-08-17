import { NothingToDoError, backoffFor, mergeMethodFor, runAction } from './actions';
import type { GitHubClient } from './githubClient';
import { asHttpError, describeError } from './githubClient';
import { resolveUpdates } from './renovate/resolve';
import type { ISearchPage, ISearchScope } from './search';
import {
  BODIES_QUERY,
  MERGEABLE_QUERY,
  PAGE_SIZE,
  SEARCH_CEILING,
  SEARCH_QUERY,
  authorsFor,
  buildSearchQuery,
  describeScope,
  mergePrs,
  normalizePage,
  planSearches,
  splitScope,
  checkRunState,
} from './search';
import type {
  ActionKind,
  CheckState,
  IActionResult,
  IDashboardState,
  IGraphqlRateLimit,
  IOwnerToken,
  IPrCheck,
  IRenovatePr,
  IRenovateResolution,
  ISettings,
  MergeMethod,
  ITruncatedScope,
  Mergeable,
} from './types';

/**
 * How long to wait before asking again about the pull requests GitHub had not finished computing
 * mergeability for. It is computed on demand, and asking is what triggers it.
 */
export const MERGEABLE_RETRY_MS = 3000;

/**
 * A run of pages is stopped here so that one runaway search cannot spend the whole GraphQL quota.
 */
const MAX_PAGES = 40;

/**
 * How many bodies to ask for at once. Bodies are large, so a big batch is a slow response rather
 * than a cheap one; several small ones also let rows fill in progressively.
 */
export const BODY_BATCH_SIZE = 10;

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
  restRateLimit: undefined,
  paused: false,
  backoffUntil: undefined,
  backoffReason: undefined,
  totalCount: 0,
  rateLimit: undefined,
  lastRefreshedAt: undefined,
  truncated: [],
};

interface IScopeResult {
  prs: IRenovatePr[];
  issueCount: number;
  truncated: ITruncatedScope | undefined;
}

interface IMergeableNode {
  id?: string;
  mergeable?: string | null;
}

interface IMergeableResponse {
  nodes?: (IMergeableNode | null)[] | null;
}

interface IBodyNode {
  id?: string;
  body?: string | null;
}

interface IBodyResponse {
  nodes?: (IBodyNode | null)[] | null;
}

interface IRefreshNode {
  id?: string;
  state?: string | null;
  updatedAt?: string;
  mergeable?: string | null;
  reviewDecision?: string | null;
}

interface IRefreshResponse {
  nodes?: (IRefreshNode | null)[] | null;
}

/**
 * Re-reads the handful of fields a write can change, for the pull requests a write touched.
 */
const REFRESH_QUERY = `query($ids: [ID!]!) {
  rateLimit { limit cost remaining resetAt }
  nodes(ids: $ids) {
    ... on PullRequest { id state updatedAt mergeable reviewDecision }
  }
}`;

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
  /**
   * Parsed bodies, keyed by pull request id and update time, so a body is parsed once and a pull
   * request that has since changed is not shown a stale parse.
   */
  private readonly bodyCache = new Map<string, IRenovateResolution>();
  private readonly bodiesInFlight = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
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
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
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
   * Re-reads the checks of pull requests that were still running, over REST and conditionally.
   *
   * A `304` is free, which is what makes a thirty-second interval affordable for the handful of
   * pull requests that are actually moving.
   * @param prs The pull requests to re-read.
   */
  public async pollChecks(prs: IRenovatePr[]): Promise<void> {
    const generation = this.generation;
    const updates = new Map<string, { checkState: CheckState; checks: IPrCheck[] }>();

    for (const pr of prs) {
      // Jittered so that a batch does not arrive as a burst, and so two tabs do not sync up.
      this.pendingPolledAt.set(pr.id, Date.now() + Math.floor(Math.random() * PENDING_POLL_MS * 0.3));
      const [ owner, name ] = splitRepo(pr.repo);
      try {
        const { runs, notModified } = await this.client.getCheckRuns(owner, name, pr.headSha);
        if (this.generation !== generation) {
          return;
        }
        if (notModified) {
          continue;
        }
        const checks = runs.map(run => ({
          name: run.name,
          state: checkRunState(run.status, run.conclusion),
          url: run.details_url ?? undefined,
        }));
        updates.set(pr.id, { checkState: worstOf(checks), checks });
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
        // A single repository the token cannot read its checks for is not worth a banner.
      }
    }

    this.patch({
      prs: updates.size === 0 ?
        this.state.prs :
        this.state.prs.map((pr) => {
          const update = updates.get(pr.id);
          return update === undefined ? pr : { ...pr, ...update };
        }),
      restRateLimit: this.client.rateLimit,
    });
  }

  /**
   * Fetches every configured scope, publishing rows as each page arrives.
   */
  public async refresh(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    this.patch({ loading: true, error: undefined, bodyError: undefined, truncated: []});

    const authors = authorsFor(this.settings);
    const groups: IRenovatePr[][] = [];
    const truncated: ITruncatedScope[] = [];
    let totalCount = 0;

    try {
      for (const scope of planSearches(this.viewerLogin, this.settings.orgs, this.ownerTokens)) {
        // A combined scope that hits the ceiling is retried one owner at a time, which is the only
        // lever available: the ceiling is per result set, not per account.
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
      loading: false,
      totalCount,
      truncated,
      lastRefreshedAt: Date.now(),
      rateLimit: this.client.graphqlRateLimit,
      restRateLimit: this.client.rateLimit,
    });
    this.lastFullPoll = Date.now();
    this.scheduleMergeableRetry(generation);
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
    let after: string | undefined;
    let issueCount = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.client.graphql<ISearchPage>(
        SEARCH_QUERY,
        { q: query, first: PAGE_SIZE, after: after ?? null },
        scope.tokenOwner,
      );
      if (this.generation !== generation) {
        return { prs: [], issueCount: 0, truncated: undefined };
      }
      issueCount = response.search?.issueCount ?? 0;
      collected.push(...normalizePage(response));
      groups[slot] = collected;
      this.patch({
        prs: mergePrs(groups),
        totalCount: countSoFar + issueCount,
        rateLimit: this.client.graphqlRateLimit,
      });

      const pageInfo = response.search?.pageInfo;
      if (pageInfo?.hasNextPage !== true || typeof pageInfo.endCursor !== 'string') {
        break;
      }
      after = pageInfo.endCursor;
    }

    // GitHub reports the true match count but hands over at most SEARCH_CEILING of them, so a
    // count at or above the ceiling means rows are missing, not merely numerous.
    const truncated = issueCount >= SEARCH_CEILING ?
        { label: describeScope(scope), count: issueCount } :
      undefined;
    return { prs: collected, issueCount, truncated };
  }

  // GitHub computes mergeability lazily; the first answer for a pull request nobody has looked at
  // in a while is UNKNOWN, and asking is what starts the computation. So ask once more, shortly.
  private scheduleMergeableRetry(generation: number): void {
    const pending = this.state.prs.filter(pr => pr.mergeable === 'UNKNOWN').map(pr => pr.id);
    if (pending.length === 0) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.resolveMergeable(pending, generation).catch(() => {
        // Mergeability is an enrichment: a pull request whose state stays unknown still lists.
      });
    }, MERGEABLE_RETRY_MS);
  }

  private async resolveMergeable(ids: string[], generation: number): Promise<void> {
    const response = await this.client.graphql<IMergeableResponse>(MERGEABLE_QUERY, { ids });
    if (this.generation !== generation) {
      return;
    }
    const resolved = new Map<string, Mergeable>();
    for (const node of response.nodes ?? []) {
      if (node?.id !== undefined && (node.mergeable === 'MERGEABLE' || node.mergeable === 'CONFLICTING')) {
        resolved.set(node.id, node.mergeable);
      }
    }
    if (resolved.size === 0) {
      this.patch({ rateLimit: this.client.graphqlRateLimit });
      return;
    }
    this.patch({
      prs: this.state.prs.map((pr) => {
        const mergeable = resolved.get(pr.id);
        return mergeable === undefined ? pr : { ...pr, mergeable };
      }),
      rateLimit: this.client.graphqlRateLimit,
    });
  }

  /**
   * Fetches the bodies of the given pull requests and folds them into their parses.
   *
   * Called when something actually needs them: when the list is grouped by dependency, where a
   * group pull request's members matter, and when a row is expanded. Anything already fetched, or
   * already in flight, is skipped.
   * @param ids The pull requests to fetch bodies for.
   */
  public async loadBodies(ids: string[]): Promise<void> {
    const generation = this.generation;
    const wanted = this.state.prs.filter(pr =>
      ids.includes(pr.id) && !pr.bodyLoaded && !this.bodiesInFlight.has(pr.id));

    // A body already parsed under the same update time needs no request at all.
    const cached = wanted.filter(pr => this.bodyCache.has(cacheKey(pr)));
    if (cached.length > 0) {
      this.applyParses(new Map(cached.map(pr => [ pr.id, this.bodyCache.get(cacheKey(pr)) ])));
    }

    const toFetch = wanted.filter(pr => !this.bodyCache.has(cacheKey(pr)));
    for (const pr of toFetch) {
      this.bodiesInFlight.add(pr.id);
    }

    try {
      for (let start = 0; start < toFetch.length; start += BODY_BATCH_SIZE) {
        const batch = toFetch.slice(start, start + BODY_BATCH_SIZE);
        const response = await this.client.graphql<IBodyResponse>(
          BODIES_QUERY,
          { ids: batch.map(pr => pr.id) },
        );
        if (this.generation !== generation) {
          return;
        }
        const bodies = new Map<string, string>();
        for (const node of response.nodes ?? []) {
          if (node?.id !== undefined && typeof node.body === 'string') {
            bodies.set(node.id, node.body);
          }
        }
        const parses = new Map<string, IRenovateResolution | undefined>();
        for (const pr of batch) {
          const body = bodies.get(pr.id);
          // A body GitHub did not hand over still counts as loaded: asking again would fail the
          // same way, and the title parse is what the row keeps.
          const parse = body === undefined ? undefined : resolveUpdates(pr, body);
          if (parse !== undefined) {
            this.bodyCache.set(cacheKey(pr), parse);
          }
          parses.set(pr.id, parse);
        }
        this.applyParses(parses);
        this.patch({ rateLimit: this.client.graphqlRateLimit });
      }
    } catch (error: unknown) {
      if (this.generation === generation) {
        this.patch({ bodyError: describeError(error) });
      }
    } finally {
      for (const pr of toFetch) {
        this.bodiesInFlight.delete(pr.id);
      }
    }
  }

  // A parse of `undefined` means the body was asked for and did not arrive; the row keeps the
  // parse it already had and is marked loaded so nothing asks again.
  private applyParses(parses: Map<string, IRenovateResolution | undefined>): void {
    this.patch({
      prs: this.state.prs.map((pr) => {
        if (!parses.has(pr.id)) {
          return pr;
        }
        const parse = parses.get(pr.id);
        return { ...pr, parse: parse ?? pr.parse, bodyLoaded: true };
      }),
    });
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

  // A write changes one pull request, so one small query brings it back up to date. Re-running
  // the whole search would cost far more and would still lag the index by a few seconds.
  private async refreshPrs(prs: IRenovatePr[], generation: number): Promise<void> {
    if (prs.length === 0) {
      return;
    }
    try {
      const response = await this.client.graphql<IRefreshResponse>(
        REFRESH_QUERY,
        { ids: prs.map(pr => pr.id) },
      );
      if (this.generation !== generation) {
        return;
      }
      const fresh = new Map<string, IRefreshNode>();
      for (const node of response.nodes ?? []) {
        if (node?.id !== undefined) {
          fresh.set(node.id, node);
        }
      }
      this.patch({
        prs: this.state.prs
          // A pull request that has been merged or closed is no longer part of the backlog.
          .filter(pr => fresh.get(pr.id)?.state === undefined || fresh.get(pr.id)?.state === 'OPEN')
          .map((pr) => {
            const node = fresh.get(pr.id);
            if (node === undefined) {
              return pr;
            }
            return {
              ...pr,
              updatedAt: node.updatedAt ?? pr.updatedAt,
              mergeable: node.mergeable === 'MERGEABLE' || node.mergeable === 'CONFLICTING' ?
                node.mergeable :
                'UNKNOWN',
              reviewDecision: node.reviewDecision === 'APPROVED' ||
                node.reviewDecision === 'CHANGES_REQUESTED' ||
                node.reviewDecision === 'REVIEW_REQUIRED' ?
                node.reviewDecision :
                null,
            };
          }),
        rateLimit: this.client.graphqlRateLimit,
      });
      this.setSelection(this.state.selected);
    } catch {
      // The writes themselves already reported their own outcome; a stale row is a small price
      // next to an error message about a refresh nobody asked for.
    }
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

// The worst state among a commit's checks, which is how a row is coloured when the rollup is not
// on hand — the REST listing has no equivalent of GraphQL's rollup state.
function worstOf(checks: IPrCheck[]): CheckState {
  // `none` is the answer both when there are no checks and when every one of them is itself
  // inconclusive — a commit whose only check was skipped says nothing either way.
  const order: CheckState[] = [ 'failure', 'error', 'pending', 'success' ];
  return order.find(state => checks.some(check => check.state === state)) ?? 'none';
}

function splitRepo(repo: string): [string, string] {
  const slash = repo.indexOf('/');
  return [ repo.slice(0, Math.max(0, slash)), repo.slice(slash + 1) ];
}

// A body is only worth reusing while the pull request it came from has not changed.
function cacheKey(pr: IRenovatePr): string {
  return `${pr.id}@${pr.updatedAt}`;
}

/**
 * The GraphQL quota, as a fraction of its limit, or 1 when it is not known yet.
 * @param rateLimit A GraphQL rate limit.
 */
export function quotaRatio(rateLimit: IGraphqlRateLimit | undefined): number {
  return rateLimit === undefined ? 1 : rateLimit.remaining / Math.max(1, rateLimit.limit);
}
