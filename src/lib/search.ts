import type {
  CheckState,
  IGraphqlRateLimit,
  IOwnerToken,
  IPrCheck,
  IRenovatePr,
  ISettings,
  Mergeable,
  ReviewDecision,
} from './types';
import { DEFAULT_RENOVATE_AUTHORS, DEPENDABOT_AUTHOR } from './types';

/**
 * How many results one page of the search asks for. GitHub caps `first` at 100, but every node
 * drags its check rollup along, so smaller pages paint sooner and cost less when one fails.
 */
export const PAGE_SIZE = 50;

/**
 * GitHub's search index never returns more than this many results for one query, whatever the
 * reported total says.
 */
export const SEARCH_CEILING = 1000;

/**
 * Logins that GitHub's search syntax spells as an app rather than as a user.
 *
 * A GitHub App posts under `<slug>[bot]`, and `author:<slug>[bot]` does not match it — the syntax
 * for that is `author:app/<slug>`.
 */
const APP_AUTHORS: Record<string, string> = {
  'renovate[bot]': 'app/renovate',
  [DEPENDABOT_AUTHOR]: 'app/dependabot',
};

/**
 * The bot logins a given configuration counts as a dependency bot, in the order they are queried.
 * @param settings The current settings.
 */
export function authorsFor(settings: ISettings): string[] {
  const authors = [ ...DEFAULT_RENOVATE_AUTHORS, ...settings.extraAuthors ];
  if (settings.includeDependabot) {
    authors.push(DEPENDABOT_AUTHOR);
  }
  // A login typed into the settings that is already a default must not be queried twice.
  const seen = new Set<string>();
  return authors.filter((author) => {
    const key = author.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * One search request: a set of owners to look in, and the token that can see them.
 */
export interface ISearchScope {
  /**
   * The owner whose token this search must use, or undefined to use the main token.
   */
  tokenOwner: string | undefined;
  /**
   * The owners this search covers, as bare logins.
   */
  owners: string[];
}

/**
 * Splits the configured accounts into the fewest searches that can actually see all of them.
 *
 * One search per token is the most that can be combined, because a fine-grained token reaches a
 * single resource owner: folding an organisation that has its own token into the main search would
 * quietly return its public pull requests only.
 * @param viewerLogin The authenticated user's login.
 * @param orgs The configured organisations.
 * @param ownerTokens The per-owner tokens.
 */
export function planSearches(
  viewerLogin: string,
  orgs: string[],
  ownerTokens: IOwnerToken[],
): ISearchScope[] {
  const withToken = new Map(ownerTokens.map(entry => [ entry.owner.toLowerCase(), entry.owner ]));
  const scopes: ISearchScope[] = [];
  const shared: string[] = [ viewerLogin ];

  const seen = new Set([ viewerLogin.toLowerCase() ]);
  for (const org of orgs) {
    const key = org.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const owned = withToken.get(key);
    if (owned === undefined) {
      shared.push(org);
    } else {
      scopes.push({ tokenOwner: owned, owners: [ org ]});
    }
  }

  return [{ tokenOwner: undefined, owners: shared }, ...scopes ];
}

/**
 * Splits a scope covering several owners into one scope per owner.
 *
 * This is the fallback for the search ceiling: the same set of pull requests, fetched as several
 * smaller result sets, each with its own 1000-result headroom.
 * @param scope A search scope.
 */
export function splitScope(scope: ISearchScope): ISearchScope[] {
  return scope.owners.map(owner => ({ tokenOwner: scope.tokenOwner, owners: [ owner ]}));
}

/**
 * Builds the search query for one scope.
 *
 * The owner qualifiers are not optional: without at least one, `author:app/renovate` matches every
 * Renovate pull request on GitHub, which is both useless and expensive. That is asserted rather
 * than assumed.
 * @param scope The owners to search in.
 * @param authors The bot logins to match on.
 */
export function buildSearchQuery(scope: ISearchScope, authors: string[]): string {
  const owners = scope.owners.filter(owner => owner.trim().length > 0);
  if (owners.length === 0) {
    throw new Error('Refusing to search all of GitHub: a search needs at least one user or org');
  }
  if (authors.length === 0) {
    throw new Error('Refusing to search every pull request: a search needs at least one author');
  }
  const scopeTerms = owners.map((owner, index) =>
    // The viewer is always the first owner of the shared scope, and `user:` is what matches an
    // account rather than an organisation. Both qualifiers are OR'd together by GitHub anyway.
    (index === 0 && scope.tokenOwner === undefined ? `user:${owner}` : `org:${owner}`));
  const authorTerms = authors.map(author => `author:${APP_AUTHORS[author] ?? author}`);
  return [ 'is:open', 'is:pr', 'archived:false', ...authorTerms, ...scopeTerms ].join(' ');
}

/**
 * A human-readable name for a scope, for the "results were cut off" warning.
 * @param scope A search scope.
 */
export function describeScope(scope: ISearchScope): string {
  return scope.owners.join(', ');
}

/**
 * The bulk query.
 *
 * `body` is deliberately absent: Renovate pull request bodies carry entire release-note sections,
 * and multiplying tens of kilobytes by hundreds of pull requests makes the first paint crawl.
 * Bodies are fetched on demand instead.
 */
export const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  rateLimit { limit cost remaining resetAt }
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id number title url headRefName baseRefName headRefOid
        createdAt updatedAt isDraft mergeable reviewDecision
        author { login }
        labels(first: 10) { nodes { name } }
        repository { nameWithOwner isPrivate viewerPermission owner { login } }
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 30) {
                  totalCount
                  nodes {
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Re-asks for the mergeability of pull requests GitHub had not computed yet.
 */
export const MERGEABLE_QUERY = `query($ids: [ID!]!) {
  rateLimit { limit cost remaining resetAt }
  nodes(ids: $ids) {
    ... on PullRequest { id mergeable }
  }
}`;

export interface IApiRollupContext {
  name?: string;
  status?: string | null;
  conclusion?: string | null;
  detailsUrl?: string | null;
  context?: string;
  state?: string | null;
  targetUrl?: string | null;
}

export interface IApiNode {
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  headRefName?: string;
  baseRefName?: string;
  headRefOid?: string;
  createdAt?: string;
  updatedAt?: string;
  isDraft?: boolean;
  mergeable?: string | null;
  reviewDecision?: string | null;
  author?: { login?: string } | null;
  labels?: { nodes?: ({ name?: string } | null)[] | null } | null;
  repository?: {
    nameWithOwner?: string;
    isPrivate?: boolean;
    viewerPermission?: string | null;
    owner?: { login?: string } | null;
  } | null;
  commits?: {
    nodes?: ({
      commit?: {
        oid?: string;
        statusCheckRollup?: {
          state?: string | null;
          contexts?: { totalCount?: number; nodes?: (IApiRollupContext | null)[] | null } | null;
        } | null;
      } | null;
    } | null)[] | null;
  } | null;
}

export interface ISearchPage {
  rateLimit: IGraphqlRateLimit | undefined;
  search?: {
    issueCount?: number;
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
    nodes?: (IApiNode | null)[] | null;
  } | null;
}

/**
 * Maps a check run's status/conclusion pair onto the one state the row is coloured by.
 * @param status The `status` field of a check run.
 * @param conclusion The `conclusion` field of a check run.
 */
export function checkRunState(status: string | null | undefined, conclusion: string | null | undefined): CheckState {
  if (status !== 'COMPLETED') {
    return 'pending';
  }
  switch (conclusion) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'STARTUP_FAILURE':
      return 'failure';
    case 'ACTION_REQUIRED':
      return 'error';
    // A cancelled, skipped, neutral or stale check says nothing about the code, so it is not a
    // failure — it just is not a success either.
    default:
      return 'none';
  }
}

/**
 * Maps a commit status context's state onto a check state.
 * @param state The `state` field of a status context or a rollup.
 */
export function statusContextState(state: string | null | undefined): CheckState {
  switch (state) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
      return 'failure';
    case 'ERROR':
      return 'error';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

function toChecks(contexts: (IApiRollupContext | null)[]): IPrCheck[] {
  const checks: IPrCheck[] = [];
  for (const context of contexts) {
    if (context === null) {
      continue;
    }
    if (typeof context.name === 'string') {
      checks.push({
        name: context.name,
        state: checkRunState(context.status, context.conclusion),
        url: context.detailsUrl ?? undefined,
      });
    } else if (typeof context.context === 'string') {
      checks.push({
        name: context.context,
        state: statusContextState(context.state),
        url: context.targetUrl ?? undefined,
      });
    }
  }
  return checks;
}

function toMergeable(value: string | null | undefined): Mergeable {
  return value === 'MERGEABLE' || value === 'CONFLICTING' ? value : 'UNKNOWN';
}

function toReviewDecision(value: string | null | undefined): ReviewDecision {
  return value === 'APPROVED' || value === 'CHANGES_REQUESTED' || value === 'REVIEW_REQUIRED' ?
    value :
    null;
}

/**
 * Turns one search result node into a dashboard pull request.
 *
 * Every field is treated as possibly absent. A search that spans many repositories will meet ones
 * the token can only partly see, and one missing field must cost one pull request at most.
 * @param node A `PullRequest` node from the search query.
 */
export function normalizePr(node: IApiNode | null): IRenovatePr | undefined {
  if (node === null || typeof node.id !== 'string' || typeof node.number !== 'number') {
    return undefined;
  }
  const repo = node.repository?.nameWithOwner;
  if (typeof repo !== 'string') {
    return undefined;
  }

  const commit = node.commits?.nodes?.[0]?.commit;
  const rollup = commit?.statusCheckRollup;
  const checks = toChecks(rollup?.contexts?.nodes ?? []);
  // A null rollup means the head commit has no checks at all, which is grey rather than red. When
  // there is a rollup, its own state is authoritative: the contexts are capped at 30, so counting
  // only those would call a repository with 40 checks green while one of the other 10 is failing.
  const checkState: CheckState = rollup === null || rollup === undefined ?
    'none' :
    statusContextState(rollup.state);

  const permission = node.repository?.viewerPermission;
  return {
    id: node.id,
    repo,
    owner: node.repository?.owner?.login ?? repo.slice(0, Math.max(0, repo.indexOf('/'))),
    number: node.number,
    title: node.title ?? '',
    url: node.url ?? '',
    branch: node.headRefName ?? '',
    baseBranch: node.baseRefName ?? '',
    author: node.author?.login ?? '',
    createdAt: node.createdAt ?? '',
    updatedAt: node.updatedAt ?? node.createdAt ?? '',
    isDraft: node.isDraft === true,
    isPrivate: node.repository?.isPrivate === true,
    labels: (node.labels?.nodes ?? [])
      .map(label => label?.name)
      .filter((name): name is string => typeof name === 'string'),
    mergeable: toMergeable(node.mergeable),
    reviewDecision: toReviewDecision(node.reviewDecision),
    viewerCanMerge: permission === 'ADMIN' || permission === 'MAINTAIN' || permission === 'WRITE',
    checkState,
    checks,
    headSha: commit?.oid ?? node.headRefOid ?? '',
  };
}

/**
 * Turns a raw search page into pull requests, dropping anything unrecognisable.
 * @param page One page of search results.
 */
export function normalizePage(page: ISearchPage): IRenovatePr[] {
  return (page.search?.nodes ?? [])
    .map(node => normalizePr(node ?? null))
    .filter((pr): pr is IRenovatePr => pr !== undefined);
}

/**
 * Merges pull requests from several searches, keeping the newest copy of each.
 *
 * The search index lags reality by a few seconds, so two overlapping searches can return the same
 * pull request twice, in two different states.
 * @param groups Pull requests from each search.
 */
export function mergePrs(groups: IRenovatePr[][]): IRenovatePr[] {
  const byId = new Map<string, IRenovatePr>();
  for (const group of groups) {
    for (const pr of group) {
      const existing = byId.get(pr.id);
      if (existing === undefined || existing.updatedAt < pr.updatedAt) {
        byId.set(pr.id, pr);
      }
    }
  }
  return [ ...byId.values() ];
}
