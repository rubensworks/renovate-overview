/**
 * Where the personal access token currently lives, if anywhere.
 */
export type TokenLocation = 'local' | 'none' | 'session';

export type Theme = 'auto' | 'dark' | 'light';

/**
 * The authenticated user.
 */
export interface IViewer {
  login: string;
  name: string;
  /**
   * Loaded from `avatars.githubusercontent.com`, the one host besides `api.github.com` this app
   * reaches. An `<img>` carries no `Authorization` header, so the token is not involved.
   */
  avatarUrl: string;
}

export interface IRateLimit {
  limit: number;
  remaining: number;
  /**
   * Unix timestamp in seconds at which the quota resets.
   */
  reset: number;
}

/**
 * An extra token for one owner, used instead of the main token for everything that owner owns.
 *
 * A fine-grained token only reaches the resource owner it was created for, so seeing an
 * organisation's private repositories takes a token of its own. Holding several side by side is
 * the only way to have your own repositories and an organisation's on one dashboard.
 */
export interface IOwnerToken {
  /**
   * The user or organisation login this token belongs to, as typed.
   */
  owner: string;
  token: string;
}

export interface ISettings {
  /**
   * Organisations whose Renovate pull requests are pulled in, alongside the viewer's own.
   */
  orgs: string[];
  /**
   * Extra bot logins that count as Renovate, for self-hosted bots running under their own account.
   */
  extraAuthors: string[];
  /**
   * Whether Dependabot pull requests are listed too. Their bodies and titles are parsed
   * separately, so this is a deliberate opt-in rather than another entry in {@link extraAuthors}.
   */
  includeDependabot: boolean;
  /**
   * Whether merge, approve, rebase and close are offered at all. Off until the user says
   * otherwise, so a token with no write permissions is a complete first-run experience.
   */
  writeActions: boolean;
  theme: Theme;
}

/**
 * The state of a pull request's checks, rolled up into the one thing the row is coloured by.
 *
 * `none` is its own state rather than a kind of failure: a head commit with no checks at all is
 * the normal case in a repository without CI, and colouring it red would be a lie.
 */
export type CheckState = 'error' | 'failure' | 'none' | 'pending' | 'success';

export const CHECK_STATE_LABELS: Record<CheckState, string> = {
  success: 'Passing',
  failure: 'Failing',
  pending: 'Running',
  error: 'Errored',
  none: 'No checks',
};

export interface IPrCheck {
  name: string;
  state: CheckState;
  url: string | undefined;
}

/**
 * GitHub computes mergeability asynchronously, so `UNKNOWN` means "ask again", not "conflicting".
 */
export type Mergeable = 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN';

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

/**
 * One open pull request from a dependency bot, as the dashboard holds it.
 *
 * This is raw GitHub data only. What the pull request actually updates is parsed separately, so
 * the parser can be tested without a single API shape in sight.
 */
export interface IRenovatePr {
  /**
   * The GraphQL node id, stable across refreshes and used as the identity everywhere.
   */
  id: string;
  /**
   * `owner/name`.
   */
  repo: string;
  owner: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  baseBranch: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  isPrivate: boolean;
  labels: string[];
  mergeable: Mergeable;
  reviewDecision: ReviewDecision;
  /**
   * Whether the viewer's permission on the repository is enough to merge it themselves.
   */
  viewerCanMerge: boolean;
  checkState: CheckState;
  checks: IPrCheck[];
  headSha: string;
}

/**
 * The GraphQL quota, which is counted in points rather than requests and is therefore reported
 * separately from the REST one.
 */
export interface IGraphqlRateLimit {
  limit: number;
  cost: number;
  remaining: number;
  /**
   * ISO 8601 timestamp at which the quota resets.
   */
  resetAt: string;
}

/**
 * An owner whose result set hit GitHub's 1000-result search ceiling, so its list is incomplete.
 */
export interface ITruncatedScope {
  label: string;
  count: number;
}

export interface IDashboardState {
  prs: IRenovatePr[];
  loading: boolean;
  error: string | undefined;
  /**
   * How many pull requests GitHub says match, which can exceed what it will actually hand over.
   */
  totalCount: number;
  rateLimit: IGraphqlRateLimit | undefined;
  lastRefreshedAt: number | undefined;
  /**
   * Scopes whose results were cut off at the search ceiling even after splitting per owner.
   */
  truncated: ITruncatedScope[];
}

/**
 * The bot logins treated as Renovate without any configuration.
 *
 * `renovate[bot]` is the hosted Mend app, which GitHub's search syntax spells `app/renovate`.
 * The other two are the service accounts self-hosted installations commonly run under.
 */
export const DEFAULT_RENOVATE_AUTHORS: string[] = [ 'renovate[bot]', 'renovate-bot', 'renovate' ];

/**
 * The login the Dependabot app posts under, listed only when the setting opts into it.
 */
export const DEPENDABOT_AUTHOR = 'dependabot[bot]';
