import { Octokit } from '@octokit/rest';
import type { IGraphqlRateLimit, IOwnerToken, IRateLimit, IViewer, MergeMethod } from './types';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'renovate-overview';

export interface IHttpErrorInfo {
  status: number;
  message: string;
  headers: Record<string, unknown>;
  retryAfter: number | undefined;
}

interface ICacheEntry {
  etag: string;
  data: unknown;
}

export interface IApiCheckRun {
  name: string;
  status: string | null;
  conclusion: string | null;
  details_url: string | null;
}

interface IApiCheckRuns {
  check_runs?: IApiCheckRun[];
}

export interface ICheckRunList {
  runs: IApiCheckRun[];
  /**
   * Whether GitHub answered `304`, which means nothing has changed and nothing was charged.
   */
  notModified: boolean;
}

interface IApiUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

/**
 * Normalizes an unknown thrown value into HTTP error information, when it looks like an Octokit error.
 * @param error Any thrown value.
 */
export function asHttpError(error: unknown): IHttpErrorInfo | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const candidate = <{ status: unknown; message?: unknown; response?: { headers?: unknown }}> error;
  if (typeof candidate.status !== 'number') {
    return undefined;
  }
  const rawHeaders = candidate.response?.headers;
  const headers = typeof rawHeaders === 'object' && rawHeaders !== null ? <Record<string, unknown>> rawHeaders : {};
  const retryAfter = Number(headers['retry-after']);
  return {
    status: candidate.status,
    message: typeof candidate.message === 'string' ? candidate.message : 'Unknown error',
    headers,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  };
}

/**
 * Produces a human-readable message for an error raised while talking to the GitHub API.
 * @param error Any thrown value.
 */
export function describeError(error: unknown): string {
  const httpError = asHttpError(error);
  if (httpError === undefined) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (httpError.status) {
    case 401:
      return 'Token is invalid or expired';
    case 403:
      return httpError.message.toLowerCase().includes('rate limit') ?
        'Rate limit exceeded' :
        'Access forbidden — a fine-grained token only reaches the owner it was created for';
    case 404:
      return 'Not found — the token has no access to it, or it does not exist';
    case 405:
      return 'Not allowed — the repository may forbid this merge method, or the branch is protected';
    case 409:
      return 'Conflict — the pull request is no longer mergeable';
    case 422:
      return `Rejected by GitHub: ${httpError.message}`;
    case 429:
      return 'Too many requests — GitHub asked us to slow down';
    default:
      return `HTTP ${httpError.status}: ${httpError.message}`;
  }
}

/**
 * A thin wrapper around Octokit that adds ETag-based conditional requests and rate limit bookkeeping.
 *
 * Every GET goes out with an `If-None-Match` header when a previous response for the same
 * route + parameters is known. GitHub answers unchanged resources with a `304 Not Modified`,
 * which does not count against the REST rate limit, so polling stays cheap.
 *
 * The only host it contacts is `api.github.com`, and the tokens it holds are only ever attached
 * to requests going there.
 */
export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly byOwner = new Map<string, Octokit>();
  private readonly cache = new Map<string, ICacheEntry>();
  private rateLimitValue: IRateLimit | undefined;
  private graphqlRateLimitValue: IGraphqlRateLimit | undefined;

  /**
   * @param token A personal access token. Every request carries one: unlike a per-repository
   *   view, searching for a bot's pull requests across an account is not useful anonymously.
   * @param ownerTokens Extra tokens, each used for everything one owner owns. A fine-grained
   *   token reaches a single resource owner, so this is what lets one dashboard hold your own
   *   repositories and an organisation's private ones at the same time.
   */
  public constructor(token: string, ownerTokens: IOwnerToken[] = []) {
    const options = { userAgent: USER_AGENT, request: { retries: 0 }};
    this.octokit = new Octokit({ ...options, auth: token });
    for (const entry of ownerTokens) {
      this.byOwner.set(entry.owner.toLowerCase(), new Octokit({ ...options, auth: entry.token }));
    }
  }

  /**
   * The quota left on the REST API, as of the last response that reported it.
   */
  public get rateLimit(): IRateLimit | undefined {
    return this.rateLimitValue;
  }

  /**
   * The quota left on the GraphQL API, which is counted in points rather than requests and so is
   * tracked apart from the REST one.
   */
  public get graphqlRateLimit(): IGraphqlRateLimit | undefined {
    return this.graphqlRateLimitValue;
  }

  /**
   * Runs a GraphQL query and records the quota it reports.
   *
   * GraphQL has no equivalent of a conditional request — every query costs points whether or not
   * anything changed — so this deliberately has no ETag cache behind it.
   * @param query A GraphQL document.
   * @param variables Its variables.
   * @param owner The owner this query is about, so the right token is used.
   */
  public async graphql<T>(query: string, variables: Record<string, unknown>, owner?: string): Promise<T> {
    const data = await this.clientFor(owner).graphql<T & { rateLimit?: IGraphqlRateLimit | null }>(
      query,
      variables,
    );
    const quota = data.rateLimit;
    if (quota !== null && quota !== undefined) {
      this.graphqlRateLimitValue = quota;
    }
    return data;
  }

  /**
   * Verifies the token and returns the authenticated user.
   *
   * This doubles as the token check on the setup screen: an invalid token fails here rather than
   * halfway through building the dashboard.
   */
  public async getViewer(): Promise<IViewer> {
    const { data } = await this.conditionalRequest<IApiUser>('GET /user', {});
    return { login: data.login, name: data.name ?? data.login, avatarUrl: data.avatar_url };
  }

  /**
   * Checks that a token can list an organisation's repositories.
   *
   * This is the one call a token belonging to a different resource owner cannot make, which is
   * what makes it the right validation for an organisation token: without it, a mis-scoped token
   * would be accepted and then quietly return public results only.
   * @param org An organisation login.
   */
  public async checkOrgAccess(org: string): Promise<void> {
    await this.conditionalRequest('GET /orgs/{org}/repos', { org, per_page: 1 }, org);
  }

  /**
   * Lists the check runs of a commit, conditionally.
   *
   * This is the one thing worth polling over REST rather than GraphQL: a `304 Not Modified` does
   * not count against the REST rate limit, and GraphQL has no equivalent, so re-reading the
   * checks of a handful of pending pull requests every half minute costs nothing once they settle.
   * @param owner The repository owner.
   * @param repo The repository name.
   * @param ref A commit sha.
   */
  public async getCheckRuns(owner: string, repo: string, ref: string): Promise<ICheckRunList> {
    const { data, notModified } = await this.conditionalRequest<IApiCheckRuns>(
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      { owner, repo, ref, per_page: 30 },
      owner,
    );
    return { runs: data.check_runs ?? [], notModified };
  }

  /**
   * Merges a pull request.
   * @param owner The repository owner.
   * @param repo The repository name.
   * @param number The pull request number.
   * @param method How to merge. A repository can forbid any of the three, and says so with a 405.
   */
  public async mergePr(owner: string, repo: string, number: number, method: MergeMethod): Promise<void> {
    await this.write('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
      owner,
      repo,
      pull_number: number,
      merge_method: method,
    }, owner);
  }

  /**
   * Approves a pull request, which is what unblocks Renovate's own automerge where it is gated on
   * a review.
   * @param owner The repository owner.
   * @param repo The repository name.
   * @param number The pull request number.
   */
  public async approvePr(owner: string, repo: string, number: number): Promise<void> {
    await this.write('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner,
      repo,
      pull_number: number,
      event: 'APPROVE',
    }, owner);
  }

  /**
   * Closes a pull request.
   * @param owner The repository owner.
   * @param repo The repository name.
   * @param number The pull request number.
   */
  public async closePr(owner: string, repo: string, number: number): Promise<void> {
    await this.write('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: number,
      state: 'closed',
    }, owner);
  }

  /**
   * Reads a pull request body, uncached, because it is about to be rewritten.
   * @param owner The repository owner.
   * @param repo The repository name.
   * @param number The pull request number.
   */
  public async getPrBody(owner: string, repo: string, number: number): Promise<string> {
    const data = await this.write<{ body: string | null }>('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: number,
    }, owner);
    return data.body ?? '';
  }

  /**
   * Rewrites a pull request body, which is how Renovate's control checkboxes are ticked.
   * @param owner The repository owner.
   * @param repo The repository name.
   * @param number The pull request number.
   * @param body The new body.
   */
  public async setPrBody(owner: string, repo: string, number: number, body: string): Promise<void> {
    await this.write('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: number,
      body,
    }, owner);
  }

  /**
   * Re-runs the failed jobs of a workflow run. Needs the Actions write permission, which the
   * documented read-only setup does not have.
   * @param owner The repository owner.
   * @param repo The repository name.
   * @param runId The workflow run id.
   */
  public async rerunFailedJobs(owner: string, repo: string, runId: number): Promise<void> {
    await this.write('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs', {
      owner,
      repo,
      run_id: runId,
    }, owner);
  }

  // Writes never go through the ETag cache: a conditional write is meaningless, and caching a
  // response that changed the world would be worse than useless.
  private async write<T>(
    route: string,
    parameters: Record<string, unknown>,
    owner: string,
  ): Promise<T> {
    const headers = { 'x-github-api-version': API_VERSION };
    try {
      const response = await this.clientFor(owner).request(route, { ...parameters, headers });
      this.recordRateLimit(<Record<string, unknown>> response.headers);
      return <T> <unknown> response.data;
    } catch (error: unknown) {
      const httpError = asHttpError(error);
      if (httpError !== undefined) {
        this.recordRateLimit(httpError.headers);
      }
      throw error;
    }
  }

  // Every request naming an owner goes out with that owner's token when one is configured.
  private clientFor(owner: string | undefined): Octokit {
    if (owner === undefined) {
      return this.octokit;
    }
    return this.byOwner.get(owner.toLowerCase()) ?? this.octokit;
  }

  private async conditionalRequest<T>(
    route: string,
    parameters: Record<string, unknown>,
    owner?: string,
  ): Promise<{ data: T; notModified: boolean }> {
    const cacheKey = `${route} ${JSON.stringify(parameters)}`;
    const cached = this.cache.get(cacheKey);
    const headers: Record<string, string> = { 'x-github-api-version': API_VERSION };
    if (cached !== undefined) {
      headers['if-none-match'] = cached.etag;
    }

    try {
      const response = await this.clientFor(owner).request(route, { ...parameters, headers });
      this.recordRateLimit(<Record<string, unknown>> response.headers);
      const data = <T> <unknown> response.data;
      const etag = response.headers.etag;
      if (typeof etag === 'string') {
        this.cache.set(cacheKey, { etag, data });
      }
      return { data, notModified: false };
    } catch (error: unknown) {
      const httpError = asHttpError(error);
      if (httpError !== undefined) {
        this.recordRateLimit(httpError.headers);
        if (httpError.status === 304 && cached !== undefined) {
          return { data: <T> cached.data, notModified: true };
        }
      }
      throw error;
    }
  }

  private recordRateLimit(headers: Record<string, unknown>): void {
    const remaining = Number(headers['x-ratelimit-remaining']);
    const limit = Number(headers['x-ratelimit-limit']);
    const reset = Number(headers['x-ratelimit-reset']);
    if (Number.isFinite(remaining) && Number.isFinite(limit) && Number.isFinite(reset)) {
      this.rateLimitValue = { remaining, limit, reset };
    }
  }
}
