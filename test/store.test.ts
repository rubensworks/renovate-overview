import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../src/lib/githubClient';
import { BODY_BATCH_SIZE, MERGEABLE_RETRY_MS, DashboardStore, quotaRatio } from '../src/lib/store';
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
}

function stubClient(): IStubClient {
  return { graphql: vi.fn(), graphqlRateLimit: QUOTA };
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
