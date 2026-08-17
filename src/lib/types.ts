/**
 * Where the personal access token currently lives, if anywhere.
 */
export type TokenLocation = 'local' | 'none' | 'session';

export type Theme = 'auto' | 'dark' | 'light';

/**
 * The authenticated user.
 *
 * Deliberately without an avatar URL: rendering one would make the browser fetch from
 * `avatars.githubusercontent.com`, and `api.github.com` is the only host this app contacts.
 */
export interface IViewer {
  login: string;
  name: string;
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
