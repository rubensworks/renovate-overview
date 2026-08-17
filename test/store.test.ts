import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../src/lib/githubClient';
import {
  BODY_BATCH_SIZE,
  IDLE_POLL_MS,
  PENDING_POLL_MS,
  TICK_MS,
  MAX_CONSECUTIVE_FAILURES,
  MERGEABLE_RETRY_MS,
  DashboardStore,
  quotaRatio,
} from '../src/lib/store';
import type { IGraphqlRateLimit, IOwnerToken, ISettings } from '../src/lib/types';
import { SETTINGS, node, page } from './fixtures';

const QUOTA: IGraphqlRateLimit = {
  limit: 5000,
  cost: 1,
  remaining: 4987,
  resetAt: '2026-08-17T18:00:00Z',
};

type GraphqlMock = Mock<(query: string, variables: Record<string, unknown>, owner?: string) => Promise<unknown>>;

interface IStubClient {
  graphql: GraphqlMock;
  graphqlRateLimit: IGraphqlRateLimit | undefined;
  approvePr: Mock<() => Promise<void>>;
  mergePr: Mock<() => Promise<void>>;
  getCheckRuns: Mock<() => Promise<{ runs: unknown[]; notModified: boolean }>>;
  rateLimit: { limit: number; remaining: number; reset: number } | undefined;
  closePr: Mock<() => Promise<void>>;
  getPrBody: Mock<() => Promise<string>>;
  setPrBody: Mock<() => Promise<void>>;
  rerunFailedJobs: Mock<() => Promise<void>>;
}

const approveMock: Mock<() => Promise<void>> = vi.fn();
const checksMock: Mock<() => Promise<{ runs: unknown[]; notModified: boolean }>> = vi.fn();
const getBodyMock: Mock<() => Promise<string>> = vi.fn();

function stubClient(): IStubClient {
  approveMock.mockReset();
  approveMock.mockResolvedValue();
  getBodyMock.mockReset();
  getBodyMock.mockResolvedValue('');
  checksMock.mockReset();
  checksMock.mockResolvedValue({ runs: [], notModified: true });
  return {
    graphql: vi.fn(),
    graphqlRateLimit: QUOTA,
    rateLimit: { limit: 5000, remaining: 4900, reset: 1_700_000_000 },
    getCheckRuns: checksMock,
    approvePr: approveMock,
    mergePr: vi.fn(async() => {}),
    closePr: vi.fn(async() => {}),
    getPrBody: getBodyMock,
    setPrBody: vi.fn(async() => {}),
    rerunFailedJobs: vi.fn(async() => {}),
  };
}

function hide(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

class NotAllowedError extends Error {
  public readonly status = 405;
  public readonly response = { headers: {}};
}

function notAllowed(): Error {
  return new NotAllowedError('method not allowed');
}

class RateLimitError extends Error {
  public readonly status = 429;
  public readonly response = { headers: { 'retry-after': '30' }};
}

function rateLimited(): Error {
  return new RateLimitError('slow down');
}

function makeStore(
  client: IStubClient,
  settings: ISettings = SETTINGS,
  ownerTokens: IOwnerToken[] = [],
): DashboardStore {
  return new DashboardStore(<GitHubClient> <unknown> client, 'rubensworks', settings, ownerTokens);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const NO_QUOTA: IGraphqlRateLimit | undefined = undefined;

describe('quotaRatio', () => {
  it('assumes a full quota until one is reported', () => {
    expect(quotaRatio(NO_QUOTA)).toBe(1);
  });

  it('reports what is left as a fraction', () => {
    expect(quotaRatio({ ...QUOTA, limit: 100, remaining: 25 })).toBe(0.25);
  });

  it('never divides by zero', () => {
    expect(quotaRatio({ ...QUOTA, limit: 0, remaining: 0 })).toBe(0);
  });
});

describe('DashboardStore', () => {
  it('starts empty and idle', () => {
    const store = makeStore(stubClient());
    expect(store.getSnapshot()).toEqual({
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
    });
  });

  it('notifies subscribers, and stops once they unsubscribe', async() => {
    const client = stubClient();
    client.graphql.mockResolvedValue(page());
    const store = makeStore(client);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.refresh();
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    const seen = listener.mock.calls.length;
    unsubscribe();
    await store.refresh();
    expect(listener).toHaveBeenCalledTimes(seen);
    store.dispose();
  });

  it('searches the viewer, and only the viewer, by default', async() => {
    const client = stubClient();
    client.graphql.mockResolvedValue(page());
    const store = makeStore(client);
    await store.refresh();

    expect(client.graphql).toHaveBeenCalledTimes(1);
    const [ , variables ] = <[string, { q: string }]> client.graphql.mock.calls[0];
    expect(variables.q).toContain('user:rubensworks');
    expect(store.getSnapshot().prs).toHaveLength(1);
    expect(store.getSnapshot().loading).toBe(false);
    store.dispose();
  });

  it('reports the GraphQL quota it was told about', async() => {
    const client = stubClient();
    client.graphql.mockResolvedValue(page());
    const store = makeStore(client);
    await store.refresh();
    expect(store.getSnapshot().rateLimit).toEqual(QUOTA);
    store.dispose();
  });

  describe('pagination', () => {
    it('follows the cursor and publishes each page as it lands', async() => {
      const client = stubClient();
      const seen: number[] = [];
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'A' }) ], { issueCount: 2, hasNextPage: true, endCursor: 'C1' }))
        .mockResolvedValueOnce(page([ node({ id: 'B' }) ], { issueCount: 2, hasNextPage: false }));
      const store = makeStore(client);
      store.subscribe(() => {
        seen.push(store.getSnapshot().prs.length);
      });

      await store.refresh();

      const [ , first ] = <[string, { after: string | null }]> client.graphql.mock.calls[0];
      const [ , second ] = <[string, { after: string | null }]> client.graphql.mock.calls[1];
      expect(first.after).toBeNull();
      expect(second.after).toBe('C1');
      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ 'A', 'B' ]);
      // The first page was on screen before the second one arrived.
      expect(seen).toContain(1);
      store.dispose();
    });

    it('copes with a page that reports no total at all', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue({ rateLimit: NO_QUOTA, search: { nodes: []}});
      const store = makeStore(client);
      await store.refresh();

      expect(store.getSnapshot().totalCount).toBe(0);
      expect(store.getSnapshot().prs).toEqual([]);
      store.dispose();
    });

    it('stops when the cursor is missing, however hasNextPage is set', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node() ], { hasNextPage: true, endCursor: null }));
      const store = makeStore(client);
      await store.refresh();
      expect(client.graphql).toHaveBeenCalledTimes(1);
      store.dispose();
    });

    it('stops after a bounded number of pages rather than spending the whole quota', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node() ], { hasNextPage: true, endCursor: 'C' }));
      const store = makeStore(client);
      await store.refresh();
      expect(client.graphql).toHaveBeenCalledTimes(40);
      store.dispose();
    });
  });

  describe('several accounts', () => {
    it('runs one search per token and merges the results', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'MINE' }) ]))
        .mockResolvedValueOnce(page([ node({ id: 'THEIRS' }) ]));
      const store = makeStore(
        client,
        { ...SETTINGS, orgs: [ 'comunica' ]},
        [{ owner: 'comunica', token: 'org' }],
      );
      await store.refresh();

      expect(client.graphql).toHaveBeenCalledTimes(2);
      expect(client.graphql.mock.calls[0]?.[2]).toBeUndefined();
      expect(client.graphql.mock.calls[1]?.[2]).toBe('comunica');
      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ 'MINE', 'THEIRS' ]);
      expect(store.getSnapshot().totalCount).toBe(2);
      store.dispose();
    });

    it('folds an organisation without its own token into the main search', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page());
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      await store.refresh();

      expect(client.graphql).toHaveBeenCalledTimes(1);
      const [ , variables ] = <[string, { q: string }]> client.graphql.mock.calls[0];
      expect(variables.q).toContain('org:comunica');
      store.dispose();
    });
  });

  describe('the search ceiling', () => {
    it('retries a multi-owner search one owner at a time when it is capped', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'X' }) ], { issueCount: 1000 }))
        .mockResolvedValueOnce(page([ node({ id: 'A' }) ], { issueCount: 400 }))
        .mockResolvedValueOnce(page([ node({ id: 'B' }) ], { issueCount: 300 }));
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      await store.refresh();

      expect(client.graphql).toHaveBeenCalledTimes(3);
      // The capped combined result is discarded in favour of the two that fit.
      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ 'A', 'B' ]);
      expect(store.getSnapshot().totalCount).toBe(700);
      expect(store.getSnapshot().truncated).toEqual([]);
      store.dispose();
    });

    it('warns when a single owner is still over the ceiling after splitting', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'X' }) ], { issueCount: 1000 }))
        .mockResolvedValueOnce(page([ node({ id: 'A' }) ], { issueCount: 1200 }))
        .mockResolvedValueOnce(page([ node({ id: 'B' }) ], { issueCount: 20 }));
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      await store.refresh();

      expect(store.getSnapshot().truncated).toEqual([{ label: 'rubensworks', count: 1200 }]);
      store.dispose();
    });

    it('abandons the per-owner retry when a newer refresh starts midway', async() => {
      const client = stubClient();
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      let calls = 0;
      client.graphql.mockImplementation(async() => {
        calls += 1;
        if (calls === 2) {
          store.dispose();
        }
        return page([ node() ], { issueCount: calls === 1 ? 1000 : 5 });
      });
      await store.refresh();

      expect(calls).toBe(2);
      expect(store.getSnapshot().lastRefreshedAt).toBeUndefined();
    });

    it('warns directly when a single-owner search is capped', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node() ], { issueCount: 5000 }));
      const store = makeStore(client);
      await store.refresh();

      expect(client.graphql).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().truncated).toEqual([{ label: 'rubensworks', count: 5000 }]);
      store.dispose();
    });
  });

  describe('mergeability', () => {
    it('asks again for the ones GitHub had not computed, and applies the answer', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]))
        .mockResolvedValueOnce({ nodes: [{ id: 'U', mergeable: 'CONFLICTING' }]});
      const store = makeStore(client);
      await store.refresh();
      expect(store.getSnapshot().prs[0]?.mergeable).toBe('UNKNOWN');

      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS);
      expect(store.getSnapshot().prs[0]?.mergeable).toBe('CONFLICTING');
      store.dispose();
    });

    it('does not ask when everything is already known', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page());
      const store = makeStore(client);
      await store.refresh();

      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS * 2);
      expect(client.graphql).toHaveBeenCalledTimes(1);
      store.dispose();
    });

    it('touches only the pull requests the answer covers', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([
          node({ id: 'A', mergeable: 'UNKNOWN' }),
          node({ id: 'B', mergeable: 'UNKNOWN' }),
        ]))
        .mockResolvedValueOnce({ nodes: [{ id: 'A', mergeable: 'MERGEABLE' }]});
      const store = makeStore(client);
      await store.refresh();
      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS);

      expect(store.getSnapshot().prs.map(entry => entry.mergeable)).toEqual([ 'MERGEABLE', 'UNKNOWN' ]);
      store.dispose();
    });

    it('leaves the rows alone when the answer is still unknown', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]))
        .mockResolvedValueOnce({ nodes: [ null, { id: 'U', mergeable: 'UNKNOWN' }, {}]});
      const store = makeStore(client);
      await store.refresh();
      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS);

      expect(store.getSnapshot().prs[0]?.mergeable).toBe('UNKNOWN');
      store.dispose();
    });

    it('copes with a response carrying no nodes', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]))
        .mockResolvedValueOnce({});
      const store = makeStore(client);
      await store.refresh();
      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS);
      expect(store.getSnapshot().prs[0]?.mergeable).toBe('UNKNOWN');
      store.dispose();
    });

    it('shrugs off a failed re-ask, since an unknown pull request still lists', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]))
        .mockRejectedValueOnce(new Error('boom'));
      const store = makeStore(client);
      await store.refresh();
      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS);

      expect(store.getSnapshot().error).toBeUndefined();
      expect(store.getSnapshot().prs).toHaveLength(1);
      store.dispose();
    });

    it('drops a pending re-ask when the store is disposed', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]));
      const store = makeStore(client);
      await store.refresh();
      store.dispose();

      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS * 2);
      expect(client.graphql).toHaveBeenCalledTimes(1);
    });

    it('drops a re-ask whose answer arrives after a newer refresh started', async() => {
      const client = stubClient();
      client.graphql
        .mockResolvedValueOnce(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]))
        .mockImplementationOnce(async() => {
          await store.refresh();
          return { nodes: [{ id: 'U', mergeable: 'MERGEABLE' }]};
        })
        .mockResolvedValue(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]));
      const store = makeStore(client);
      await store.refresh();
      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS);

      expect(store.getSnapshot().prs[0]?.mergeable).toBe('UNKNOWN');
      store.dispose();
    });
  });

  describe('failure', () => {
    it('reports an error and stops loading', async() => {
      const client = stubClient();
      client.graphql.mockRejectedValue(new Error('offline'));
      const store = makeStore(client);
      await store.refresh();

      expect(store.getSnapshot().error).toBe('offline');
      expect(store.getSnapshot().loading).toBe(false);
      store.dispose();
    });

    it('reports a refusal to search all of GitHub as an error rather than throwing', async() => {
      const client = stubClient();
      const store = new DashboardStore(<GitHubClient> <unknown> client, '', SETTINGS, []);
      await store.refresh();

      expect(store.getSnapshot().error).toContain('at least one user or org');
      expect(client.graphql).not.toHaveBeenCalled();
      store.dispose();
    });

    it('ignores a failure belonging to a superseded refresh', async() => {
      const client = stubClient();
      const store = makeStore(client);
      client.graphql.mockImplementationOnce(async() => {
        store.dispose();
        throw new Error('stale');
      });
      await store.refresh();

      expect(store.getSnapshot().error).toBeUndefined();
    });
  });

  describe('superseded refreshes', () => {
    it('drops a page that lands after a newer refresh started', async() => {
      const client = stubClient();
      const store = makeStore(client);
      client.graphql
        .mockImplementationOnce(async() => {
          store.dispose();
          return page([ node({ id: 'STALE' }) ]);
        })
        .mockResolvedValue(page());
      await store.refresh();

      expect(store.getSnapshot().prs).toEqual([]);
    });

    it('drops a whole scope that finishes after a newer refresh started', async() => {
      const client = stubClient();
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]}, [{ owner: 'comunica', token: 'x' }]);
      let calls = 0;
      client.graphql.mockImplementation(async() => {
        calls += 1;
        if (calls === 1) {
          store.dispose();
        }
        return page();
      });
      await store.refresh();

      expect(store.getSnapshot().lastRefreshedAt).toBeUndefined();
    });

    it('cancels a scheduled re-ask when a refresh starts', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node({ id: 'U', mergeable: 'UNKNOWN' }) ]));
      const store = makeStore(client);
      await store.refresh();
      await store.refresh();
      await vi.advanceTimersByTimeAsync(MERGEABLE_RETRY_MS);

      // Two searches and one re-ask, rather than one re-ask per refresh.
      expect(client.graphql).toHaveBeenCalledTimes(3);
      store.dispose();
    });
  });

  describe('loadBodies', () => {
    const TABLE = [
      '| Package | Type | Update | Change |',
      '|---|---|---|---|',
      '| [eslint](u) | devDependencies | minor | [`8.56.0` -> `8.57.0`](d) |',
      '| [@types/node](u) | devDependencies | patch | [`20.11.4` -> `20.11.5`](d) |',
    ].join('\n');

    async function loadedStore(client: IStubClient): Promise<DashboardStore> {
      const store = makeStore(client);
      await store.refresh();
      return store;
    }

    it('fetches a body and folds it into the parse, turning a group into its packages', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([
        node({ id: 'G', title: 'Update all non-major dependencies', headRefName: 'renovate/all-minor-patch' }),
      ]));
      const store = await loadedStore(client);
      expect(store.getSnapshot().prs[0]?.parse.updates).toEqual([]);

      client.graphql.mockResolvedValueOnce({ nodes: [{ id: 'G', body: TABLE }]});
      await store.loadBodies([ 'G' ]);

      const [ loaded ] = store.getSnapshot().prs;
      expect(loaded?.bodyLoaded).toBe(true);
      expect(loaded?.parse.source).toBe('body');
      expect(loaded?.parse.updates.map(entry => entry.groupKey)).toEqual([ 'eslint', 'types-node' ]);
      store.dispose();
    });

    it('asks for nothing when every body is already loaded', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      client.graphql.mockResolvedValueOnce({ nodes: [{ id: 'A', body: TABLE }]});
      await store.loadBodies([ 'A' ]);
      const before = client.graphql.mock.calls.length;

      await store.loadBodies([ 'A' ]);
      expect(client.graphql).toHaveBeenCalledTimes(before);
      store.dispose();
    });

    it('asks for nothing when the list does not hold the pull request', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      const before = client.graphql.mock.calls.length;

      await store.loadBodies([ 'SOMETHING_ELSE' ]);
      expect(client.graphql).toHaveBeenCalledTimes(before);
      store.dispose();
    });

    it('reuses a parsed body across refreshes while the pull request has not changed', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      client.graphql.mockResolvedValueOnce({ nodes: [{ id: 'A', body: TABLE }]});
      await store.loadBodies([ 'A' ]);

      client.graphql.mockResolvedValue(page([ node({ id: 'A' }) ]));
      await store.refresh();
      expect(store.getSnapshot().prs[0]?.bodyLoaded).toBe(false);
      const before = client.graphql.mock.calls.length;

      await store.loadBodies([ 'A' ]);
      // Served from the cache: no request, but the parse is back.
      expect(client.graphql).toHaveBeenCalledTimes(before);
      expect(store.getSnapshot().prs[0]?.parse.source).toBe('body');
      store.dispose();
    });

    it('refetches a body once the pull request has been updated', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      client.graphql.mockResolvedValueOnce({ nodes: [{ id: 'A', body: TABLE }]});
      await store.loadBodies([ 'A' ]);

      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A', updatedAt: '2026-08-16T10:00:00Z' }) ]));
      await store.refresh();
      const before = client.graphql.mock.calls.length;
      client.graphql.mockResolvedValueOnce({ nodes: [{ id: 'A', body: TABLE }]});
      await store.loadBodies([ 'A' ]);

      expect(client.graphql.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('asks in batches rather than for hundreds of bodies at once', async() => {
      const client = stubClient();
      const many = Array.from({ length: BODY_BATCH_SIZE + 3 }, (_unused, index) => node({ id: `P${index}` }));
      client.graphql.mockResolvedValueOnce(page(many));
      const store = await loadedStore(client);

      client.graphql.mockResolvedValue({ nodes: []});
      await store.loadBodies(many.map(entry => String(entry.id)));

      const bodyCalls = client.graphql.mock.calls.filter(call => String(call[0]).includes('body'));
      expect(bodyCalls).toHaveLength(2);
      expect((<{ ids: string[] }> bodyCalls[0]?.[1]).ids).toHaveLength(BODY_BATCH_SIZE);
      store.dispose();
    });

    it('marks a body GitHub did not hand over as loaded, rather than asking forever', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);

      client.graphql.mockResolvedValueOnce({ nodes: [ null, { id: 'A', body: null }]});
      await store.loadBodies([ 'A' ]);
      expect(store.getSnapshot().prs[0]?.bodyLoaded).toBe(true);
      expect(store.getSnapshot().prs[0]?.parse.source).toBe('title');
      store.dispose();
    });

    it('copes with a response carrying no nodes', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      client.graphql.mockResolvedValueOnce({});
      await store.loadBodies([ 'A' ]);
      expect(store.getSnapshot().prs[0]?.bodyLoaded).toBe(true);
      store.dispose();
    });

    it('reports a failure apart from the list, which is still perfectly usable', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      client.graphql.mockRejectedValueOnce(new Error('body fetch failed'));

      await store.loadBodies([ 'A' ]);
      expect(store.getSnapshot().bodyError).toBe('body fetch failed');
      expect(store.getSnapshot().error).toBeUndefined();
      expect(store.getSnapshot().prs).toHaveLength(1);
      store.dispose();
    });

    it('drops an answer that arrives after a newer refresh started', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      client.graphql.mockImplementationOnce(async() => {
        store.dispose();
        return { nodes: [{ id: 'A', body: TABLE }]};
      });

      await store.loadBodies([ 'A' ]);
      expect(store.getSnapshot().prs[0]?.bodyLoaded).toBe(false);
    });

    it('does not report a failure belonging to a superseded refresh', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);
      client.graphql.mockImplementationOnce(async() => {
        store.dispose();
        throw new Error('stale');
      });

      await store.loadBodies([ 'A' ]);
      expect(store.getSnapshot().bodyError).toBeUndefined();
    });

    it('does not ask twice for a body already in flight', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValueOnce(page([ node({ id: 'A' }) ]));
      const store = await loadedStore(client);

      let release = (_: unknown): void => {};
      client.graphql.mockImplementationOnce(async() => new Promise((resolve) => {
        release = resolve;
      }));
      const first = store.loadBodies([ 'A' ]);
      const second = store.loadBodies([ 'A' ]);
      release({ nodes: [{ id: 'A', body: TABLE }]});
      await Promise.all([ first, second ]);

      const bodyCalls = client.graphql.mock.calls.filter(call => String(call[0]).includes('body'));
      expect(bodyCalls).toHaveLength(1);
      store.dispose();
    });
  });

  describe('selection', () => {
    async function loaded(client: IStubClient): Promise<DashboardStore> {
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }), node({ id: 'B' }) ]));
      const store = makeStore(client);
      await store.refresh();
      return store;
    }

    it('selects and deselects', async() => {
      const store = await loaded(stubClient());
      store.toggleSelection('A');
      expect(store.getSnapshot().selected).toEqual([ 'A' ]);
      store.toggleSelection('A');
      expect(store.getSnapshot().selected).toEqual([]);
      store.dispose();
    });

    it('ignores anything that is not on the list, and never selects one twice', async() => {
      const store = await loaded(stubClient());
      store.setSelection([ 'A', 'A', 'GONE' ]);
      expect(store.getSnapshot().selected).toEqual([ 'A' ]);
      store.dispose();
    });

    it('survives a refresh, and says how much of it did not', async() => {
      const client = stubClient();
      const store = await loaded(client);
      store.setSelection([ 'A', 'B' ]);

      client.graphql.mockResolvedValue(page([ node({ id: 'A' }) ]));
      await store.refresh();

      expect(store.getSnapshot().selected).toEqual([ 'A' ]);
      expect(store.getSnapshot().droppedFromSelection).toBe(1);
      store.dispose();
    });

    it('stops reporting a drop once the selection is touched again', async() => {
      const client = stubClient();
      const store = await loaded(client);
      store.setSelection([ 'A', 'B' ]);
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }) ]));
      await store.refresh();

      store.setSelection([ 'A' ]);
      expect(store.getSnapshot().droppedFromSelection).toBe(0);
      store.dispose();
    });
  });

  describe('runActions', () => {
    async function loaded(client: IStubClient, ids = [ 'A', 'B' ]): Promise<DashboardStore> {
      client.graphql.mockResolvedValue(page(ids.map(id => node({ id }))));
      const store = makeStore(client);
      await store.refresh();
      client.graphql.mockReset();
      client.graphql.mockResolvedValue({ nodes: []});
      return store;
    }

    it('runs the action once per pull request and reports each result', async() => {
      const client = stubClient();
      const store = await loaded(client);
      const prs = store.getSnapshot().prs;

      await store.runActions('approve', prs);

      expect(approveMock).toHaveBeenCalledTimes(2);
      const run = store.getSnapshot().actionRun;
      expect(run?.kind).toBe('approve');
      expect(run?.running).toBe(false);
      expect(run?.results.map(result => result.outcome)).toEqual([ 'succeeded', 'succeeded' ]);
      expect(run?.results[0]?.label).toBe('rubensworks/jbr.js#42');
      store.dispose();
    });

    it('records a failure against its own pull request and carries on', async() => {
      const client = stubClient();
      const store = await loaded(client);
      approveMock.mockRejectedValueOnce(new Error('no permission'));

      await store.runActions('approve', store.getSnapshot().prs);

      const run = store.getSnapshot().actionRun;
      expect(run?.results.map(result => result.outcome)).toEqual([ 'failed', 'succeeded' ]);
      expect(run?.results[0]?.message).toBe('no permission');
      expect(run?.stoppedReason).toBeUndefined();
      store.dispose();
    });

    it('gives up after several failures in a row rather than hammering the API', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 'A', 'B', 'C', 'D', 'E' ]);
      approveMock.mockRejectedValue(new Error('no permission'));

      await store.runActions('approve', store.getSnapshot().prs);

      expect(approveMock).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
      const run = store.getSnapshot().actionRun;
      expect(run?.stoppedReason).toContain('failures in a row');
      expect(run?.results.at(-1)?.outcome).toBe('pending');
      store.dispose();
    });

    it('stops at once when GitHub asks it to slow down', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 'A', 'B', 'C' ]);
      approveMock.mockRejectedValue(rateLimited());

      await store.runActions('approve', store.getSnapshot().prs);

      expect(approveMock).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().actionRun?.stoppedReason).toContain('slow down');
      store.dispose();
    });

    it('does not count "nothing to do" as a failure', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 'A', 'B', 'C', 'D' ]);
      getBodyMock.mockResolvedValue('no checkbox at all');

      await store.runActions('rebase', store.getSnapshot().prs);

      const run = store.getSnapshot().actionRun;
      expect(run?.results.map(result => result.outcome)).toEqual([ 'skipped', 'skipped', 'skipped', 'skipped' ]);
      expect(run?.stoppedReason).toBeUndefined();
      store.dispose();
    });

    it('re-reads only the pull requests it actually changed', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.graphql.mockResolvedValue({ nodes: [{
        id: 'A',
        state: 'OPEN',
        updatedAt: '2026-08-17T00:00:00Z',
        mergeable: 'CONFLICTING',
        reviewDecision: 'APPROVED',
      }]});

      await store.runActions('approve', [ store.getSnapshot().prs[0]! ]);

      const [ , variables ] = <[string, { ids: string[] }]> client.graphql.mock.calls[0];
      expect(variables.ids).toEqual([ 'A' ]);
      const refreshed = store.getSnapshot().prs.find(entry => entry.id === 'A');
      expect(refreshed?.mergeable).toBe('CONFLICTING');
      expect(refreshed?.reviewDecision).toBe('APPROVED');
      store.dispose();
    });

    it('normalises whatever the re-read reports, and keeps what it does not mention', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.graphql.mockResolvedValue({ nodes: [
        null,
        {},
        { id: 'A', state: 'OPEN', mergeable: 'SOMETHING_ELSE', reviewDecision: 'ODD' },
      ]});

      await store.runActions('approve', store.getSnapshot().prs);

      const refreshed = store.getSnapshot().prs.find(entry => entry.id === 'A');
      expect(refreshed?.mergeable).toBe('UNKNOWN');
      expect(refreshed?.reviewDecision).toBeNull();
      // No updatedAt came back, so the one already on hand stands.
      expect(refreshed?.updatedAt).toBe('2026-08-10T10:00:00Z');
      // 'B' was not mentioned at all, so it is left exactly as it was.
      expect(store.getSnapshot().prs.find(entry => entry.id === 'B')).toBeDefined();
      store.dispose();
    });

    it('reads every review decision it knows', async() => {
      for (const decision of <const>[ 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED' ]) {
        const client = stubClient();
        const store = await loaded(client, [ 'A' ]);
        client.graphql.mockResolvedValue({ nodes: [{ id: 'A', state: 'OPEN', reviewDecision: decision }]});
        await store.runActions('approve', store.getSnapshot().prs);
        expect(store.getSnapshot().prs[0]?.reviewDecision).toBe(decision);
        store.dispose();
      }
    });

    it('copes with a re-read that carries no nodes at all', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 'A' ]);
      client.graphql.mockResolvedValue({});
      await store.runActions('approve', store.getSnapshot().prs);
      expect(store.getSnapshot().prs).toHaveLength(1);
      store.dispose();
    });

    it('drops a pull request that is no longer open', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.graphql.mockResolvedValue({ nodes: [{ id: 'A', state: 'MERGED' }]});

      await store.runActions('merge', [ store.getSnapshot().prs[0]! ]);

      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ 'B' ]);
      store.dispose();
    });

    it('leaves rows alone when the re-read fails, since the writes already reported themselves', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.graphql.mockRejectedValue(new Error('refresh failed'));

      await store.runActions('approve', [ store.getSnapshot().prs[0]! ]);

      expect(store.getSnapshot().error).toBeUndefined();
      expect(store.getSnapshot().prs).toHaveLength(2);
      expect(store.getSnapshot().actionRun?.results[0]?.outcome).toBe('succeeded');
      store.dispose();
    });

    it('re-reads nothing when nothing succeeded', async() => {
      const client = stubClient();
      const store = await loaded(client);
      approveMock.mockRejectedValue(new Error('no'));

      await store.runActions('approve', store.getSnapshot().prs);
      expect(client.graphql).not.toHaveBeenCalled();
      store.dispose();
    });

    it('abandons a run whose store has been replaced partway through', async() => {
      const client = stubClient();
      const store = await loaded(client);
      approveMock.mockImplementationOnce(async() => {
        store.dispose();
      });

      await store.runActions('approve', store.getSnapshot().prs);
      expect(approveMock).toHaveBeenCalledTimes(1);
      store.dispose();
    });

    it('does not re-read after a run whose store was replaced on its last pull request', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 'A' ]);
      approveMock.mockImplementationOnce(async() => {
        store.dispose();
      });

      await store.runActions('approve', store.getSnapshot().prs);
      expect(client.graphql).not.toHaveBeenCalled();
    });

    it('drops a re-read whose answer arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.graphql.mockImplementationOnce(async() => {
        store.dispose();
        return { nodes: [{ id: 'A', state: 'MERGED' }]};
      });

      await store.runActions('approve', [ store.getSnapshot().prs[0]! ]);
      expect(store.getSnapshot().prs).toHaveLength(2);
    });

    it('forgets a finished run when asked', async() => {
      const client = stubClient();
      const store = await loaded(client);
      await store.runActions('approve', store.getSnapshot().prs);
      store.clearActionRun();
      expect(store.getSnapshot().actionRun).toBeUndefined();
      store.dispose();
    });
  });

  describe('polling', () => {
    async function started(client: IStubClient, prNodes = [ node({ id: 'A' }) ]): Promise<DashboardStore> {
      client.graphql.mockResolvedValue(page(prNodes));
      const store = makeStore(client);
      await store.refresh();
      store.start();
      return store;
    }

    it('re-runs the whole search once the idle interval has passed', async() => {
      const client = stubClient();
      const store = await started(client);
      const before = client.graphql.mock.calls.length;

      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS + TICK_MS);
      expect(client.graphql.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('does nothing at all before then', async() => {
      const client = stubClient();
      const store = await started(client);
      const before = client.graphql.mock.calls.length;

      await vi.advanceTimersByTimeAsync(TICK_MS * 5);
      expect(client.graphql).toHaveBeenCalledTimes(before);
      store.dispose();
    });

    it('re-reads a pending pull request over REST, far more often than the whole search', async() => {
      const client = stubClient();
      const store = await started(client, [ node({ id: 'A', commits: { nodes: [{ commit: {
        oid: 'sha1',
        statusCheckRollup: { state: 'PENDING', contexts: { totalCount: 0, nodes: []}},
      }}]}}) ]);

      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS + TICK_MS);
      expect(checksMock).toHaveBeenCalled();
      store.dispose();
    });

    it('leaves settled pull requests alone', async() => {
      const client = stubClient();
      const store = await started(client);

      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS * 2);
      expect(checksMock).not.toHaveBeenCalled();
      store.dispose();
    });

    it('does not poll while the tab is hidden', async() => {
      const client = stubClient();
      const store = await started(client);
      const before = client.graphql.mock.calls.length;

      hide(true);
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
      expect(client.graphql).toHaveBeenCalledTimes(before);
      expect(store.getSnapshot().paused).toBe(true);

      hide(false);
      await vi.advanceTimersByTimeAsync(TICK_MS * 2);
      expect(client.graphql.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('slows down as the quota drains, and stops short of spending it all', async() => {
      const client = stubClient();
      client.graphqlRateLimit = { ...QUOTA, remaining: 10 };
      const store = await started(client);
      const before = client.graphql.mock.calls.length;

      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
      expect(client.graphql).toHaveBeenCalledTimes(before);
      expect(store.getSnapshot().backoffReason).toContain('quota nearly spent');
      store.dispose();
    });

    it('polls less often, rather than not at all, on a merely low quota', async() => {
      const client = stubClient();
      client.graphqlRateLimit = { ...QUOTA, remaining: 400 };
      const store = await started(client);
      const before = client.graphql.mock.calls.length;

      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
      expect(client.graphql).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 4);
      expect(client.graphql.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('starting twice does not start twice', async() => {
      const client = stubClient();
      const store = await started(client);
      store.start();
      const before = client.graphql.mock.calls.length;
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS + TICK_MS);
      expect(client.graphql.mock.calls.length).toBe(before + 1);
      store.dispose();
    });

    it('stops polling once disposed', async() => {
      const client = stubClient();
      const store = await started(client);
      store.dispose();
      const before = client.graphql.mock.calls.length;
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 3);
      expect(client.graphql).toHaveBeenCalledTimes(before);
    });
  });

  describe('pollChecks', () => {
    async function loaded(client: IStubClient): Promise<DashboardStore> {
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }) ]));
      const store = makeStore(client);
      await store.refresh();
      return store;
    }

    it('spends nothing and changes nothing when GitHub answers 304', async() => {
      const client = stubClient();
      const store = await loaded(client);
      const before = store.getSnapshot().prs;

      await store.pollChecks(before);
      expect(store.getSnapshot().prs).toBe(before);
      store.dispose();
    });

    it('applies the new checks, and recolours the row by the worst of them', async() => {
      const client = stubClient();
      const store = await loaded(client);
      checksMock.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', details_url: 'https://ci/1' },
        { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', details_url: null },
      ]});

      await store.pollChecks(store.getSnapshot().prs);

      const [ updated ] = store.getSnapshot().prs;
      expect(updated?.checkState).toBe('failure');
      expect(updated?.checks).toEqual([
        { name: 'build', state: 'success', url: 'https://ci/1' },
        { name: 'lint', state: 'failure', url: undefined },
      ]);
      store.dispose();
    });

    it('leaves alone the pull requests whose checks did not change', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }), node({ id: 'B' }) ]));
      const store = makeStore(client);
      await store.refresh();
      const before = store.getSnapshot().prs;

      checksMock
        .mockResolvedValueOnce({ notModified: false, runs: [
          { name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', details_url: null },
        ]})
        .mockResolvedValueOnce({ notModified: true, runs: []});

      await store.pollChecks(before);

      const after = store.getSnapshot().prs;
      expect(after[0]?.checkState).toBe('failure');
      // Untouched, right down to the object identity.
      expect(after[1]).toBe(before[1]);
      store.dispose();
    });

    it('reads a commit whose only checks are inconclusive as grey too', async() => {
      const client = stubClient();
      const store = await loaded(client);
      checksMock.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'COMPLETED', conclusion: 'SKIPPED', details_url: null },
      ]});

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('none');
      store.dispose();
    });

    it('reads a commit with no checks as grey', async() => {
      const client = stubClient();
      const store = await loaded(client);
      checksMock.mockResolvedValue({ notModified: false, runs: []});

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('none');
      store.dispose();
    });

    it('shrugs off one repository it cannot read', async() => {
      const client = stubClient();
      const store = await loaded(client);
      checksMock.mockRejectedValue(new Error('no access'));

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().error).toBeUndefined();
      expect(store.getSnapshot().backoffUntil).toBeUndefined();
      store.dispose();
    });

    it('backs off, and says so, when GitHub asks it to slow down', async() => {
      const client = stubClient();
      const store = await loaded(client);
      checksMock.mockRejectedValue(rateLimited());

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().backoffReason).toBe('GitHub asked us to slow down');
      expect(store.getSnapshot().backoffUntil).toBeGreaterThan(Date.now());
      store.dispose();
    });

    it('reports the REST quota, which is what the conditional polling spends', async() => {
      const client = stubClient();
      const store = await loaded(client);
      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().restRateLimit).toEqual({ limit: 5000, remaining: 4900, reset: 1_700_000_000 });
      store.dispose();
    });

    it('drops an answer that arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client);
      checksMock.mockImplementationOnce(async() => {
        store.dispose();
        return { notModified: false, runs: []};
      });

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('success');
    });

    it('drops a failure that arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client);
      checksMock.mockImplementationOnce(async() => {
        store.dispose();
        throw rateLimited();
      });

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().backoffReason).toBeUndefined();
    });
  });

  describe('a merge method a repository refuses', () => {
    it('remembers the next one to try for that repository', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }) ]));
      const saved: ISettings[] = [];
      const store = new DashboardStore(
        <GitHubClient> <unknown> client,
        'rubensworks',
        SETTINGS,
        [],
        next => saved.push(next),
      );
      await store.refresh();
      client.mergePr.mockRejectedValue(notAllowed());

      await store.runActions('merge', store.getSnapshot().prs);

      expect(saved.at(-1)?.repoMergeMethods).toEqual({ 'rubensworks/jbr.js': 'merge' });
      store.dispose();
    });

    it('says nothing when the same refusal happens twice', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }), node({ id: 'B' }) ]));
      const saved: ISettings[] = [];
      const store = new DashboardStore(
        <GitHubClient> <unknown> client,
        'rubensworks',
        SETTINGS,
        [],
        next => saved.push(next),
      );
      await store.refresh();
      client.mergePr.mockRejectedValue(notAllowed());

      await store.runActions('merge', store.getSnapshot().prs);
      expect(saved).toHaveLength(1);
      store.dispose();
    });

    it('leaves the settings alone for any other failure', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page([ node({ id: 'A' }) ]));
      const saved: ISettings[] = [];
      const store = new DashboardStore(
        <GitHubClient> <unknown> client,
        'rubensworks',
        SETTINGS,
        [],
        next => saved.push(next),
      );
      await store.refresh();
      client.mergePr.mockRejectedValue(new Error('offline'));

      await store.runActions('merge', store.getSnapshot().prs);
      expect(saved).toEqual([]);
      store.dispose();
    });
  });

  describe('configure', () => {
    it('changes what the next refresh looks at without blanking the rows', async() => {
      const client = stubClient();
      client.graphql.mockResolvedValue(page());
      const store = makeStore(client);
      await store.refresh();
      const before = store.getSnapshot().prs;

      store.configure({ ...SETTINGS, orgs: [ 'comunica' ]}, []);
      expect(store.getSnapshot().prs).toBe(before);

      await store.refresh();
      const [ , variables ] = <[string, { q: string }]> client.graphql.mock.calls.at(-1);
      expect(variables.q).toContain('org:comunica');
      store.dispose();
    });
  });
});
