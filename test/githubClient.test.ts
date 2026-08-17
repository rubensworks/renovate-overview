import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, asHttpError, describeError } from '../src/lib/githubClient';

const { requestMock, constructorMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: class FakeOctokit {
    public readonly request = requestMock;

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
      requestMock.mockResolvedValue(response({ login: 'rubensworks', name: 'Ruben Taelman' }));
      await expect(new GitHubClient('t').getViewer())
        .resolves.toEqual({ login: 'rubensworks', name: 'Ruben Taelman' });
      expect(requestMock).toHaveBeenCalledWith('GET /user', containing({
        headers: containing({ 'x-github-api-version': '2022-11-28' }),
      }));
    });

    it('falls back to the login when the account has no name', async() => {
      requestMock.mockResolvedValue(response({ login: 'rubensworks', name: null }));
      await expect(new GitHubClient('t').getViewer())
        .resolves.toEqual({ login: 'rubensworks', name: 'rubensworks' });
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

  describe('rate limit bookkeeping', () => {
    it('starts out unknown', () => {
      expect(new GitHubClient('t').rateLimit).toBeUndefined();
    });

    it('records the quota reported by a response', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null }));
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
      requestMock.mockResolvedValue({ data: { login: 'a', name: null }, headers: {}});
      const client = new GitHubClient('t');
      await client.getViewer();
      expect(client.rateLimit).toBeUndefined();
    });
  });

  describe('conditional requests', () => {
    it('sends the stored ETag on a repeat request and reuses the cached body on a 304', async() => {
      requestMock.mockResolvedValueOnce(response({ login: 'a', name: null }, { etag: 'W/"1"' }));
      const client = new GitHubClient('t');
      await client.getViewer();

      requestMock.mockRejectedValueOnce(new HttpError(304, 'Not Modified'));
      await expect(client.getViewer()).resolves.toEqual({ login: 'a', name: 'a' });
      expect(requestMock).toHaveBeenLastCalledWith('GET /user', containing({
        headers: containing({ 'if-none-match': 'W/"1"' }),
      }));
    });

    it('does not cache a response without an ETag', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null }));
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
