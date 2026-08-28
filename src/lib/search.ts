import { MAX_QUERY_LENGTH, excludeQualifiers } from './exclusions';
import type {
  IApiCheckRun,
  IApiPullRequest,
  IApiReview,
  IApiSearchItem,
  ICombinedStatus,
} from './githubClient';
import { captured } from './renovate/capture';
import { resolveUpdates } from './renovate/resolve';
import type {
  CheckState,
  IOwnerToken,
  IPrCheck,
  IRenovatePr,
  IRenovateResolution,
  ISettings,
  ReviewDecision,
} from './types';
import { DEFAULT_RENOVATE_AUTHORS, DEPENDABOT_AUTHOR } from './types';

export type { IApiPullRequest, IApiReview, IApiSearchItem, ICombinedStatus, ISearchResponse } from './githubClient';

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
 * Joins alternatives into an explicit `OR` group.
 *
 * The parentheses and the `OR` are not decoration. Under `advanced_search=true` GitHub combines
 * repeated qualifiers with AND, so `author:a author:b` asks for pull requests written by both
 * people at once and matches nothing at all. Only an explicit group means "either".
 * @param terms Some qualifiers.
 */
function orGroup(terms: string[]): string {
  return `(${terms.join(' OR ')})`;
}

/**
 * Builds the search query for one scope.
 *
 * The owner qualifiers are not optional: without at least one, `author:app/renovate` matches every
 * Renovate pull request on GitHub, which is both useless and expensive. That is asserted rather
 * than assumed.
 *
 * Excluded repositories are named as `-repo:` qualifiers so they are never fetched at all, but
 * only as far as the query length allows — the rest are dropped from the results afterwards, which
 * is what actually keeps them off the dashboard.
 * @param scope The owners to search in.
 * @param authors The bot logins to match on.
 * @param excluded Normalised excluded repositories, if any.
 */
export function buildSearchQuery(scope: ISearchScope, authors: string[], excluded: string[] = []): string {
  const owners = scope.owners.filter(owner => owner.trim().length > 0);
  if (owners.length === 0) {
    throw new Error('Refusing to search all of GitHub: a search needs at least one user or org');
  }
  if (authors.length === 0) {
    throw new Error('Refusing to search every pull request: a search needs at least one author');
  }
  const scopeTerms = owners.map((owner, index) =>
    // The viewer is always the first owner of the shared scope, and `user:` is what matches an
    // account rather than an organisation.
    (index === 0 && scope.tokenOwner === undefined ? `user:${owner}` : `org:${owner}`));
  const authorTerms = authors.map(author => `author:${APP_AUTHORS[author] ?? author}`);
  const query = [ 'is:open', 'is:pr', 'archived:false', orGroup(authorTerms), orGroup(scopeTerms) ].join(' ');
  const excludeTerms = excludeQualifiers(excluded, owners, MAX_QUERY_LENGTH - query.length);
  return excludeTerms.length === 0 ? query : `${query} ${excludeTerms.join(' ')}`;
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
 * Maps a check run's status/conclusion pair onto the one state a row is coloured by.
 * @param status The `status` field of a check run.
 * @param conclusion The `conclusion` field of a check run.
 */
export function checkRunState(status: string | null | undefined, conclusion: string | null | undefined): CheckState {
  if ((status ?? '').toLowerCase() !== 'completed') {
    return 'pending';
  }
  switch ((conclusion ?? '').toLowerCase()) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'failure';
    case 'action_required':
      return 'error';
    // A cancelled, skipped, neutral or stale check says nothing about the code, so it is not a
    // failure — it just is not a success either.
    default:
      return 'none';
  }
}

/**
 * Maps a commit status state onto a check state.
 * @param state The `state` field of a status context.
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

/**
 * Turns one search result into a pull request.
 *
 * The search endpoint carries no head commit, no branch names and no mergeability, so what comes
 * out here is deliberately half a pull request: enough to draw a row immediately, with the rest
 * filled in by {@link applyDetail} a moment later.
 * @param item One item of a `GET /search/issues` response.
 */
export function normalizeSearchItem(item: IApiSearchItem | null): IRenovatePr | undefined {
  if (item === null || typeof item.number !== 'number' || item.pull_request === undefined ||
    item.pull_request === null) {
    return undefined;
  }
  const repo = repoFromUrl(item.repository_url);
  if (repo === undefined) {
    return undefined;
  }

  const pr: IRenovatePr = {
    // Search has no node id, and `owner/repo#number` is just as stable and rather more readable.
    id: `${repo}#${item.number}`,
    repo,
    owner: repo.slice(0, Math.max(0, repo.indexOf('/'))),
    number: item.number,
    title: item.title ?? '',
    url: item.html_url ?? '',
    branch: '',
    baseBranch: '',
    author: item.user?.login ?? '',
    createdAt: item.created_at ?? '',
    updatedAt: item.updated_at ?? item.created_at ?? '',
    isDraft: item.draft === true,
    isPrivate: false,
    labels: (item.labels ?? [])
      .map(label => label?.name)
      .filter((name): name is string => typeof name === 'string'),
    mergeable: 'UNKNOWN',
    reviewDecision: null,
    // Nothing says otherwise yet, and hiding a pull request the viewer might well be able to
    // merge is worse than showing one they cannot.
    viewerCanMerge: true,
    checkState: 'none',
    checks: [],
    headSha: '',
    detailLoaded: false,
    parse: EMPTY_PARSE,
    bodyLoaded: false,
  };
  // Search returns the body, so a group pull request lists its packages from the very first
  // paint rather than waiting for a fetch of its own.
  const body = typeof item.body === 'string' ? item.body : undefined;
  return { ...pr, parse: resolveUpdates(pr, body), bodyLoaded: body !== undefined };
}

/**
 * `https://api.github.com/repos/owner/name` -> `owner/name`.
 * @param url A repository API URL.
 */
export function repoFromUrl(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  const match = /\/repos\/([^/]+\/[^/]+)$/u.exec(url);
  return match === null ? undefined : captured(match, 1);
}

/**
 * Folds the per-pull-request detail into a row drawn from the search.
 * @param pr A pull request.
 * @param detail Its `GET /repos/{owner}/{repo}/pulls/{number}` response.
 */
export function applyDetail(pr: IRenovatePr, detail: IApiPullRequest): IRenovatePr {
  const permissions = detail.base?.repo?.permissions;
  const next: IRenovatePr = {
    ...pr,
    branch: detail.head?.ref ?? pr.branch,
    baseBranch: detail.base?.ref ?? pr.baseBranch,
    headSha: detail.head?.sha ?? pr.headSha,
    isDraft: detail.draft ?? pr.isDraft,
    isPrivate: detail.base?.repo?.private === true,
    // REST reports a boolean, and null while GitHub is still working it out.
    mergeable: detail.mergeable === true ? 'MERGEABLE' : (detail.mergeable === false ? 'CONFLICTING' : 'UNKNOWN'),
    viewerCanMerge: permissions === undefined || permissions === null ?
      pr.viewerCanMerge :
      permissions.push === true || permissions.maintain === true || permissions.admin === true,
    updatedAt: detail.updated_at ?? pr.updatedAt,
    detailLoaded: true,
  };
  const body = typeof detail.body === 'string' ? detail.body : undefined;
  if (body !== undefined) {
    // The branch is known now too, which can change what the parsers make of it.
    return { ...next, parse: resolveUpdates(next, body), bodyLoaded: true };
  }
  // No body here. Re-parsing without one would throw away a body the search already handed over,
  // turning a group pull request back into its title, so that parse is kept as it is.
  return next.bodyLoaded ? next : { ...next, parse: resolveUpdates(next) };
}

/**
 * Folds check runs and commit statuses into a row.
 *
 * Both halves of CI matter: Actions reports check runs, while everything older reports commit
 * statuses, and a repository can use either or both.
 * @param pr A pull request.
 * @param runs Its check runs.
 * @param status Its combined commit status, when one was fetched.
 */
export function applyChecks(
  pr: IRenovatePr,
  runs: IApiCheckRun[],
  status: ICombinedStatus | undefined,
): IRenovatePr {
  const checks: IPrCheck[] = runs.map(run => ({
    name: run.name,
    state: checkRunState(run.status, run.conclusion),
    url: run.details_url ?? undefined,
  }));
  for (const context of status?.statuses ?? []) {
    if (context !== null && typeof context.context === 'string') {
      checks.push({
        name: context.context,
        state: statusContextState((context.state ?? '').toUpperCase()),
        url: context.target_url ?? undefined,
      });
    }
  }
  return { ...pr, checks, checkState: worstCheckState(checks) };
}

/**
 * Reads a review decision out of a pull request's reviews.
 *
 * REST has no equivalent of GraphQL's `reviewDecision`, so it is derived the way GitHub does:
 * only each reviewer's most recent verdict counts, and a request for changes outweighs an
 * approval however many approvals there are.
 * @param reviews The reviews of a pull request, oldest first.
 */
export function reviewDecisionFrom(reviews: IApiReview[]): ReviewDecision {
  const latest = new Map<string, string>();
  for (const review of reviews) {
    const login = review.user?.login;
    const state = review.state;
    // COMMENTED and PENDING are not verdicts, and must not displace one.
    if (login !== undefined && (state === 'APPROVED' || state === 'CHANGES_REQUESTED' || state === 'DISMISSED')) {
      latest.set(login, state);
    }
  }
  const verdicts = new Set(latest.values());
  if (verdicts.has('CHANGES_REQUESTED')) {
    return 'CHANGES_REQUESTED';
  }
  return verdicts.has('APPROVED') ? 'APPROVED' : null;
}

/**
 * Rolls a set of check states up into the worst one present.
 * @param checks Some checks.
 */
export function worstCheckState(checks: IPrCheck[]): CheckState {
  const order: CheckState[] = [ 'failure', 'error', 'pending', 'success' ];
  return order.find(state => checks.some(check => check.state === state)) ?? 'none';
}

/**
 * The parse a pull request carries before anything has been read out of it.
 */
const EMPTY_PARSE: IRenovateResolution = {
  updates: [],
  isGroupPr: false,
  groupName: undefined,
  updateType: 'unknown',
  source: 'unknown',
  disagreements: [],
};

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
