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

/**
 * How a pull request is merged. Repositories can forbid any of the three, which is why it is
 * configurable and overridable per repository.
 */
export type MergeMethod = 'merge' | 'rebase' | 'squash';

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  merge: 'Merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

/**
 * A write the dashboard can perform on a pull request.
 */
export type ActionKind = 'approve' | 'close' | 'merge' | 'rebase' | 'rerun';

export const ACTION_LABELS: Record<ActionKind, string> = {
  merge: 'Merge',
  approve: 'Approve',
  rebase: 'Ask Renovate to rebase',
  close: 'Close',
  rerun: 'Re-run failed jobs',
};

/**
 * Actions that can be run over a selection. Closing is deliberately absent: Renovate reads a
 * closed pull request as "never offer this update again", which is too big a thing to do in bulk.
 */
export const BULK_ACTIONS: ActionKind[] = [ 'merge', 'approve', 'rebase' ];

export type ActionOutcome = 'failed' | 'pending' | 'running' | 'skipped' | 'succeeded';

export interface IActionResult {
  prId: string;
  /**
   * `owner/repo#number`, so a result still reads sensibly after the pull request has gone.
   */
  label: string;
  outcome: ActionOutcome;
  message: string | undefined;
}

/**
 * A run of one action over one or more pull requests.
 */
export interface IActionRun {
  kind: ActionKind;
  results: IActionResult[];
  /**
   * Whether the queue is still working through the list.
   */
  running: boolean;
  /**
   * Set when the queue gave up early rather than finishing the list.
   */
  stoppedReason: string | undefined;
}

export interface ISettings {
  /**
   * Organisations whose Renovate pull requests are pulled in, alongside the viewer's own.
   */
  orgs: string[];
  /**
   * Repositories left out of the dashboard entirely, as `owner/name`.
   *
   * A repository whose Renovate pull requests are somebody else's problem — or that raises so many
   * that it drowns out everything else — is noise on a dashboard meant for working through a
   * backlog. Kept as typed, and read through `normalizeExclusions`.
   */
  excludedRepos: string[];
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
  /**
   * How to merge, unless {@link repoMergeMethods} overrides it for the repository in hand.
   */
  mergeMethod: MergeMethod;
  /**
   * Per-repository merge methods, keyed by lowercased `owner/repo`, remembered after a repository
   * refuses the default one.
   */
  repoMergeMethods: Record<string, MergeMethod>;
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
  /**
   * Whether the per-pull-request detail and checks have been fetched.
   *
   * The search endpoint carries neither the head commit nor the mergeability, so a row appears
   * from the search alone and fills in a moment later. Until then its colour means "not known
   * yet" rather than "no checks".
   */
  detailLoaded: boolean;
  /**
   * What the parser made of the title, branch and — once loaded — the body. Kept apart from the
   * raw GitHub fields above so the parser stays testable without an API shape in sight.
   */
  parse: IRenovateResolution;
  /**
   * Whether the body has been fetched and folded into {@link parse}. Bodies are large and are
   * only fetched when something actually needs them.
   */
  bodyLoaded: boolean;
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
  /**
   * A failure while fetching bodies. Kept apart from {@link error} because the list itself is
   * still perfectly usable when only the dependency details could not be loaded.
   */
  bodyError: string | undefined;
  /**
   * The ids of the selected pull requests. Kept here rather than in a component so a refresh
   * cannot silently lose it.
   */
  selected: string[];
  /**
   * Selected pull requests that disappeared from the last refresh, so the user is told rather
   * than left wondering why the count dropped.
   */
  droppedFromSelection: number;
  /**
   * The action currently running, or the last one that ran.
   */
  actionRun: IActionRun | undefined;
  /**
   * The core REST quota. Conditional requests answered with `304` do not spend it.
   */
  rateLimit: IRateLimit | undefined;
  /**
   * The search quota, which GitHub meters separately and far more tightly.
   */
  searchRateLimit: IRateLimit | undefined;
  /**
   * Whether polling is suspended because the tab is hidden.
   */
  paused: boolean;
  /**
   * Unix timestamp in milliseconds until which polling is held off, after GitHub asked us to
   * slow down or because the quota is nearly spent.
   */
  backoffUntil: number | undefined;
  backoffReason: string | undefined;
  lastRefreshedAt: number | undefined;
  /**
   * Scopes whose results were cut off at the search ceiling even after splitting per owner.
   */
  truncated: ITruncatedScope[];
}

/**
 * What kind of change a pull request makes, as Renovate itself classifies it.
 */
export type UpdateType =
  | 'digest'
  | 'lockFileMaintenance'
  | 'major'
  | 'minor'
  | 'patch'
  | 'pin'
  | 'replacement'
  | 'rollback'
  | 'unknown';

/**
 * Which of the three parsers a piece of information came from.
 *
 * Kept on every update so an inspect view can say why a pull request landed in the group it did,
 * and so a disagreement between sources stays visible instead of being quietly resolved.
 */
export type UpdateSource = 'body' | 'branch' | 'title';

export interface IDependencyUpdate {
  /**
   * The dependency as its source spelled it, for display.
   */
  depName: string;
  /**
   * {@link depName} normalised, so that `@types/node` from a title and `types-node` from a branch
   * land in the same group.
   */
  groupKey: string;
  currentVersion?: string;
  newVersion?: string;
  updateType: UpdateType;
  /**
   * `dependencies`, `devDependencies`, `action`… as the body's Type column gives it.
   */
  depType?: string;
  /**
   * Which Renovate manager this looks like: `npm`, `github-actions`, `docker`…
   */
  manager?: string;
  source: UpdateSource;
}

/**
 * What the three parsers together made of a pull request.
 */
export interface IRenovateResolution {
  updates: IDependencyUpdate[];
  isGroupPr: boolean;
  /**
   * The name of the group, when the pull request names one — `all non-major dependencies`,
   * `jest monorepo`, or whatever a custom `groupName` produced.
   */
  groupName: string | undefined;
  updateType: UpdateType;
  /**
   * Which parser the updates came from, or `unknown` when none of them recognised anything. A
   * pull request that resolves to `unknown` is still listed, under "Unrecognised".
   */
  source: UpdateSource | 'unknown';
  /**
   * Where the sources contradict each other, in words. The winning source is used either way —
   * this exists so the disagreement is visible rather than silently resolved.
   */
  disagreements: string[];
}

/**
 * What one parser made of a pull request.
 */
export interface IParseResult {
  updates: IDependencyUpdate[];
  isGroupPr: boolean;
  /**
   * The name of the group, when the pull request names one — `all non-major dependencies`,
   * `jest monorepo`, or whatever a custom `groupName` produced.
   */
  groupName: string | undefined;
  /**
   * The update type of the pull request as a whole, where it states one.
   */
  updateType: UpdateType;
  /**
   * The new version of the pull request as a whole, for group titles that name one.
   */
  newVersion: string | undefined;
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
