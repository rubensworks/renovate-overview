import type { GitHubClient } from './githubClient';
import { describeError } from './githubClient';
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
} from './search';
import type {
  IDashboardState,
  IGraphqlRateLimit,
  IOwnerToken,
  IRenovatePr,
  IRenovateResolution,
  ISettings,
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

export const INITIAL_STATE: IDashboardState = {
  prs: [],
  loading: false,
  error: undefined,
  bodyError: undefined,
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
  private readonly viewerLogin: string;
  /**
   * Parsed bodies, keyed by pull request id and update time, so a body is parsed once and a pull
   * request that has since changed is not shown a stale parse.
   */
  private readonly bodyCache = new Map<string, IRenovateResolution>();
  private readonly bodiesInFlight = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Bumped on every refresh, so a slow page from a superseded run cannot overwrite a newer one.
   */
  private generation = 0;

  public constructor(
    client: GitHubClient,
    viewerLogin: string,
    settings: ISettings,
    ownerTokens: IOwnerToken[],
  ) {
    this.client = client;
    this.viewerLogin = viewerLogin;
    this.settings = settings;
    this.ownerTokens = ownerTokens;
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

    this.patch({
      prs: mergePrs(groups),
      loading: false,
      totalCount,
      truncated,
      lastRefreshedAt: Date.now(),
      rateLimit: this.client.graphqlRateLimit,
    });
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

  private patch(next: Partial<IDashboardState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener();
    }
  }
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
