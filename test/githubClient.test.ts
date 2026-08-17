import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, asHttpError, describeError } from '../src/lib/githubClient';

const { requestMock, graphqlMock, constructorMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  graphqlMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: class FakeOctokit {
    public readonly request = requestMock;
    public readonly graphql = graphqlMock;

    public constructor(options: unknown) {
      constructorMock(options);
    }
  },
}));

const RATE_HEADERS = {
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4999',
  'x-ratelimit-reset': '1700000000',
};

interface IFakeResponse {
  data: unknown;
  headers: Record<string, unknown>;
}

function response(data: unknown, headers: Record<string, unknown> = {}): IFakeResponse {
  return { data, headers: { ...RATE_HEADERS, ...headers }};
}

// `expect.objectContaining` is typed as `any`, so every use of it is funnelled through here.
function containing(shape: Record<string, unknown>): unknown {
  return <unknown> expect.objectContaining(shape);
}

function notContaining(shape: Record<string, unknown>): unknown {
  return <unknown> expect.not.objectContaining(shape);
}

class HttpError extends Error {
  public readonly status: number;
  public readonly response: { headers: Record<string, unknown> };

  public constructor(status: number, message = 'boom', headers: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.response = { headers: { ...RATE_HEADERS, ...headers }};
  }
}

beforeEach(() => {
  requestMock.mockReset();
  graphqlMock.mockReset();
  constructorMock.mockReset();
});

describe('asHttpError', () => {
  it('ignores values that are not objects', () => {
    expect(asHttpError('boom')).toBeUndefined();
    expect(asHttpError(null)).toBeUndefined();
    expect(asHttpError(new Error('plain'))).toBeUndefined();
  });

  it('ignores objects whose status is not a number', () => {
    expect(asHttpError({ status: 'gone' })).toBeUndefined();
  });

  it('extracts status, message and headers', () => {
    expect(asHttpError(new HttpError(404, 'missing'))).toEqual({
      status: 404,
      message: 'missing',
      headers: RATE_HEADERS,
      retryAfter: undefined,
    });
  });

  it('defaults the message and headers when they are absent', () => {
    expect(asHttpError({ status: 500 })).toEqual({
      status: 500,
      message: 'Unknown error',
      headers: {},
      retryAfter: undefined,
    });
  });

  it('ignores a non-object response headers bag', () => {
    expect(asHttpError({ status: 500, response: { headers: 'nope' }})?.headers).toEqual({});
  });

  it('reads a retry-after header when it is a positive number', () => {
    expect(asHttpError(new HttpError(429, 'slow', { 'retry-after': '30' }))?.retryAfter).toBe(30);
    expect(asHttpError(new HttpError(429, 'slow', { 'retry-after': 'soon' }))?.retryAfter).toBeUndefined();
    expect(asHttpError(new HttpError(429, 'slow', { 'retry-after': '0' }))?.retryAfter).toBeUndefined();
  });
});

describe('describeError', () => {
  it('passes through the message of a plain error', () => {
    expect(describeError(new Error('offline'))).toBe('offline');
  });

  it('stringifies anything that is not an error', () => {
    expect(describeError('odd')).toBe('odd');
  });

  it('explains an expired token', () => {
    expect(describeError(new HttpError(401))).toBe('Token is invalid or expired');
  });

  it('separates a rate limit from a scope problem', () => {
    expect(describeError(new HttpError(403, 'API rate limit exceeded'))).toBe('Rate limit exceeded');
    expect(describeError(new HttpError(403, 'Resource not accessible')))
      .toContain('only reaches the owner it was created for');
  });

  it('explains a 404 as a possible access problem', () => {
    expect(describeError(new HttpError(404))).toContain('the token has no access');
  });

  it('explains a 429', () => {
    expect(describeError(new HttpError(429))).toContain('slow down');
  });

  it('explains the failures a write meets', () => {
    expect(describeError(new HttpError(405))).toContain('forbid this merge method');
    expect(describeError(new HttpError(409))).toContain('no longer mergeable');
    expect(describeError(new HttpError(422, 'Review cannot be requested'))).toContain('Review cannot be requested');
  });

  it('falls back to the status and message', () => {
    expect(describeError(new HttpError(500, 'kaboom'))).toBe('HTTP 500: kaboom');
  });
});

describe('GitHubClient', () => {
  it('authenticates with the given token', () => {
    // eslint-disable-next-line no-new
    new GitHubClient('main-token');
    expect(constructorMock).toHaveBeenCalledWith(containing({ auth: 'main-token' }));
  });

  it('builds one client per owner token', () => {
    // eslint-disable-next-line no-new
    new GitHubClient('main-token', [{ owner: 'Comunica', token: 'org-token' }]);
    expect(constructorMock).toHaveBeenCalledTimes(2);
    expect(constructorMock).toHaveBeenLastCalledWith(containing({ auth: 'org-token' }));
  });

  describe('getViewer', () => {
    it('returns the authenticated user', async() => {
      requestMock.mockResolvedValue(response({
        login: 'rubensworks',
        name: 'Ruben Taelman',
        avatar_url: 'https://avatars.githubusercontent.com/u/440384?v=4',
      }));
      await expect(new GitHubClient('t').getViewer()).resolves.toEqual({
        login: 'rubensworks',
        name: 'Ruben Taelman',
        avatarUrl: 'https://avatars.githubusercontent.com/u/440384?v=4',
      });
      expect(requestMock).toHaveBeenCalledWith('GET /user', containing({
        headers: containing({ 'x-github-api-version': '2022-11-28' }),
      }));
    });

    it('falls back to the login when the account has no name', async() => {
      requestMock.mockResolvedValue(response({ login: 'rubensworks', name: null, avatar_url: 'a.png' }));
      await expect(new GitHubClient('t').getViewer())
        .resolves.toEqual({ login: 'rubensworks', name: 'rubensworks', avatarUrl: 'a.png' });
    });

    it('propagates a failure, so the setup screen can report it', async() => {
      requestMock.mockRejectedValue(new HttpError(401));
      await expect(new GitHubClient('t').getViewer()).rejects.toThrow('boom');
    });
  });

  describe('checkOrgAccess', () => {
    it('asks for the organisation repository listing with that organisation token', async() => {
      requestMock.mockResolvedValue(response([]));
      await new GitHubClient('main', [{ owner: 'comunica', token: 'org' }]).checkOrgAccess('Comunica');
      expect(requestMock).toHaveBeenCalledWith('GET /orgs/{org}/repos', containing({
        org: 'Comunica',
        per_page: 1,
      }));
    });

    it('propagates a rejection from a wrongly scoped token', async() => {
      requestMock.mockRejectedValue(new HttpError(403, 'Resource not accessible'));
      await expect(new GitHubClient('t').checkOrgAccess('comunica')).rejects.toThrow();
    });
  });

  describe('getCheckRuns', () => {
    it('asks conditionally, so an unchanged answer costs nothing', async() => {
      requestMock.mockResolvedValue(response({ check_runs: [{ name: 'build' }]}, { etag: 'W/"1"' }));
      const client = new GitHubClient('t');
      await expect(client.getCheckRuns('o', 'r', 'sha')).resolves.toEqual({
        runs: [{ name: 'build' }],
        notModified: false,
      });
      expect(requestMock).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
        containing({ owner: 'o', repo: 'r', ref: 'sha', per_page: 30 }),
      );

      requestMock.mockRejectedValue(new HttpError(304, 'Not Modified'));
      await expect(client.getCheckRuns('o', 'r', 'sha')).resolves.toEqual({
        runs: [{ name: 'build' }],
        notModified: true,
      });
    });

    it('reads a response that lists no check runs at all', async() => {
      requestMock.mockResolvedValue(response({}));
      await expect(new GitHubClient('t').getCheckRuns('o', 'r', 'sha'))
        .resolves.toEqual({ runs: [], notModified: false });
    });
  });

  describe('writes', () => {
    beforeEach(() => {
      requestMock.mockResolvedValue(response({}));
    });

    it('merges with the given method', async() => {
      await new GitHubClient('t').mergePr('o', 'r', 7, 'squash');
      expect(requestMock).toHaveBeenCalledWith(
        'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
        containing({ owner: 'o', repo: 'r', pull_number: 7, merge_method: 'squash' }),
      );
    });

    it('approves', async() => {
      await new GitHubClient('t').approvePr('o', 'r', 7);
      expect(requestMock).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        containing({ event: 'APPROVE' }),
      );
    });

    it('closes', async() => {
      await new GitHubClient('t').closePr('o', 'r', 7);
      expect(requestMock).toHaveBeenCalledWith(
        'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
        containing({ state: 'closed' }),
      );
    });

    it('reads a body, treating a null one as empty', async() => {
      requestMock.mockResolvedValue(response({ body: 'hello' }));
      await expect(new GitHubClient('t').getPrBody('o', 'r', 7)).resolves.toBe('hello');
      requestMock.mockResolvedValue(response({ body: null }));
      await expect(new GitHubClient('t').getPrBody('o', 'r', 7)).resolves.toBe('');
    });

    it('writes a body back', async() => {
      await new GitHubClient('t').setPrBody('o', 'r', 7, 'new body');
      expect(requestMock).toHaveBeenCalledWith(
        'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
        containing({ body: 'new body' }),
      );
    });

    it('re-runs failed jobs', async() => {
      await new GitHubClient('t').rerunFailedJobs('o', 'r', 99);
      expect(requestMock).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs',
        containing({ run_id: 99 }),
      );
    });

    it('never sends a conditional header on a write, however often it is repeated', async() => {
      requestMock.mockResolvedValue(response({}, { etag: 'W/"1"' }));
      const client = new GitHubClient('t');
      await client.closePr('o', 'r', 7);
      await client.closePr('o', 'r', 7);
      expect(requestMock).toHaveBeenLastCalledWith('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', containing({
        headers: notContaining({ 'if-none-match': <unknown> expect.anything() }),
      }));
    });

    it('uses the organisation token for that organisation', async() => {
      const client = new GitHubClient('main', [{ owner: 'comunica', token: 'org' }]);
      await client.mergePr('Comunica', 'comunica', 1, 'merge');
      expect(constructorMock).toHaveBeenCalledTimes(2);
    });

    it('records the quota a write reports, and the one a failure reports', async() => {
      const client = new GitHubClient('t');
      await client.closePr('o', 'r', 7);
      expect(client.rateLimit).toEqual({ limit: 5000, remaining: 4999, reset: 1_700_000_000 });

      requestMock.mockRejectedValue(new HttpError(403, 'nope'));
      await expect(client.closePr('o', 'r', 7)).rejects.toThrow();
      expect(client.rateLimit).not.toBeUndefined();
    });

    it('propagates a failure so the queue can report it', async() => {
      requestMock.mockRejectedValue(new Error('offline'));
      await expect(new GitHubClient('t').mergePr('o', 'r', 7, 'merge')).rejects.toThrow('offline');
    });
  });

  describe('rate limit bookkeeping', () => {
    it('starts out unknown', () => {
      expect(new GitHubClient('t').rateLimit).toBeUndefined();
    });

    it('records the quota reported by a response', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null, avatar_url: 'a.png' }));
      const client = new GitHubClient('t');
      await client.getViewer();
      expect(client.rateLimit).toEqual({ limit: 5000, remaining: 4999, reset: 1_700_000_000 });
    });

    it('records the quota reported by a failure too', async() => {
      requestMock.mockRejectedValue(new HttpError(500));
      const client = new GitHubClient('t');
      await expect(client.getViewer()).rejects.toThrow();
      expect(client.rateLimit).toEqual({ limit: 5000, remaining: 4999, reset: 1_700_000_000 });
    });

    it('ignores headers that do not carry a full quota', async() => {
      requestMock.mockResolvedValue({ data: { login: 'a', name: null, avatar_url: 'a.png' }, headers: {}});
      const client = new GitHubClient('t');
      await client.getViewer();
      expect(client.rateLimit).toBeUndefined();
    });
  });

  describe('graphql', () => {
    const QUOTA = { limit: 5000, cost: 3, remaining: 4997, resetAt: '2026-08-17T18:00:00Z' };

    it('runs the query and returns its data', async() => {
      graphqlMock.mockResolvedValue({ search: { issueCount: 2 }});
      const client = new GitHubClient('t');
      await expect(client.graphql('query {}', { q: 'x' })).resolves.toEqual({ search: { issueCount: 2 }});
      expect(graphqlMock).toHaveBeenCalledWith('query {}', { q: 'x' });
    });

    it('records the quota the response reports', async() => {
      graphqlMock.mockResolvedValue({ rateLimit: QUOTA });
      const client = new GitHubClient('t');
      expect(client.graphqlRateLimit).toBeUndefined();
      await client.graphql('query {}', {});
      expect(client.graphqlRateLimit).toEqual(QUOTA);
    });

    it('keeps the last known quota when a response carries none', async() => {
      graphqlMock.mockResolvedValueOnce({ rateLimit: QUOTA }).mockResolvedValueOnce({ rateLimit: null });
      const client = new GitHubClient('t');
      await client.graphql('query {}', {});
      await client.graphql('query {}', {});
      expect(client.graphqlRateLimit).toEqual(QUOTA);
    });

    it('uses an organisation token when the query is about that organisation', async() => {
      graphqlMock.mockResolvedValue({});
      const client = new GitHubClient('main', [{ owner: 'comunica', token: 'org' }]);
      await client.graphql('query {}', {}, 'Comunica');
      // Two Octokit instances exist; the organisation one answered.
      expect(constructorMock).toHaveBeenCalledTimes(2);
      expect(graphqlMock).toHaveBeenCalledTimes(1);
    });

    it('does not swallow a failed query', async() => {
      graphqlMock.mockRejectedValue(new Error('bad query'));
      await expect(new GitHubClient('t').graphql('query {}', {})).rejects.toThrow('bad query');
    });
  });

  describe('conditional requests', () => {
    it('sends the stored ETag on a repeat request and reuses the cached body on a 304', async() => {
      requestMock.mockResolvedValueOnce(response({ login: 'a', name: null, avatar_url: 'a.png' }, { etag: 'W/"1"' }));
      const client = new GitHubClient('t');
      await client.getViewer();

      requestMock.mockRejectedValueOnce(new HttpError(304, 'Not Modified'));
      await expect(client.getViewer()).resolves.toEqual({ login: 'a', name: 'a', avatarUrl: 'a.png' });
      expect(requestMock).toHaveBeenLastCalledWith('GET /user', containing({
        headers: containing({ 'if-none-match': 'W/"1"' }),
      }));
    });

    it('does not cache a response without an ETag', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null, avatar_url: 'a.png' }));
      const client = new GitHubClient('t');
      await client.getViewer();
      await client.getViewer();
      expect(requestMock).toHaveBeenLastCalledWith('GET /user', containing({
        headers: notContaining({ 'if-none-match': <unknown> expect.anything() }),
      }));
    });

    it('rethrows a 304 that has nothing cached behind it', async() => {
      requestMock.mockRejectedValue(new HttpError(304, 'Not Modified'));
      await expect(new GitHubClient('t').getViewer()).rejects.toThrow('Not Modified');
    });

    it('rethrows a non-HTTP failure untouched', async() => {
      requestMock.mockRejectedValue(new Error('offline'));
      await expect(new GitHubClient('t').getViewer()).rejects.toThrow('offline');
    });
  });
});
