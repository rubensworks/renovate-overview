import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubClient } from '../src/lib/githubClient';
import { PAGE_SIZE } from '../src/lib/search';
import {
  ENRICH_BATCH_SIZE,
  IDLE_POLL_MS,
  MAX_CONSECUTIVE_FAILURES,
  PENDING_POLL_MS,
  SETTLED_POLL_MS,
  TICK_MS,
  DashboardStore,
  quotaRatio,
} from '../src/lib/store';
import type { IOwnerToken, IRateLimit, ISettings } from '../src/lib/types';
import { SETTINGS, prDetail, searchItem, searchPage } from './fixtures';

const QUOTA: IRateLimit = { limit: 5000, remaining: 4987, reset: 1_800_000_000 };
const SEARCH_QUOTA: IRateLimit = { limit: 30, remaining: 29, reset: 1_800_000_000 };
const NO_QUOTA: IRateLimit | undefined = undefined;

/**
 * The id the store gives a pull request, which is `owner/repo#number`.
 * @param number A pull request number.
 */
function id(number: number): string {
  return `rubensworks/jbr.js#${number}`;
}

interface IStubClient {
  searchPrs: Mock<(query: string, page: number, perPage: number, owner?: string) => Promise<unknown>>;
  getPr: Mock<() => Promise<unknown>>;
  getCheckRuns: Mock<() => Promise<{ runs: unknown[]; notModified: boolean }>>;
  getCombinedStatus: Mock<() => Promise<unknown>>;
  getReviews: Mock<() => Promise<unknown[]>>;
  rateLimit: IRateLimit | undefined;
  searchRateLimit: IRateLimit | undefined;
  approvePr: Mock<() => Promise<void>>;
  mergePr: Mock<() => Promise<void>>;
  closePr: Mock<() => Promise<void>>;
  getPrBody: Mock<() => Promise<string>>;
  setPrBody: Mock<() => Promise<void>>;
  rerunFailedJobs: Mock<() => Promise<void>>;
}

function stubClient(): IStubClient {
  return {
    searchPrs: vi.fn(async() => searchPage([])),
    getPr: vi.fn(async() => prDetail()),
    getCheckRuns: vi.fn(async() => ({ runs: [], notModified: true })),
    getCombinedStatus: vi.fn(async() => ({ statuses: []})),
    getReviews: vi.fn(async() => []),
    rateLimit: QUOTA,
    searchRateLimit: SEARCH_QUOTA,
    approvePr: vi.fn(async() => {}),
    mergePr: vi.fn(async() => {}),
    closePr: vi.fn(async() => {}),
    getPrBody: vi.fn(async() => ''),
    setPrBody: vi.fn(async() => {}),
    rerunFailedJobs: vi.fn(async() => {}),
  };
}

function makeStore(
  client: IStubClient,
  settings: ISettings = SETTINGS,
  ownerTokens: IOwnerToken[] = [],
  onSettingsChange?: (settings: ISettings) => void,
): DashboardStore {
  return new DashboardStore(
    <GitHubClient> <unknown> client,
    'rubensworks',
    settings,
    ownerTokens,
    onSettingsChange,
  );
}

/**
 * A store with the given pull requests already searched for and enriched.
 * @param client The stub client.
 * @param numbers The pull request numbers to return from the search.
 */
async function loaded(client: IStubClient, numbers: number[] = [ 42 ]): Promise<DashboardStore> {
  client.searchPrs.mockResolvedValue(searchPage(numbers.map(number => searchItem({ number }))));
  const store = makeStore(client);
  await store.refresh();
  return store;
}

function hide(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

class HttpError extends Error {
  public readonly status: number;
  public readonly response: { headers: Record<string, unknown> };

  public constructor(status: number, headers: Record<string, unknown> = {}) {
    super('boom');
    this.status = status;
    this.response = { headers };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('quotaRatio', () => {
  it('assumes a full quota until one is reported', () => {
    expect(quotaRatio(NO_QUOTA)).toBe(1);
  });

  it('reports what is left as a fraction', () => {
    expect(quotaRatio({ limit: 100, remaining: 25, reset: 0 })).toBe(0.25);
  });

  it('never divides by zero', () => {
    expect(quotaRatio({ limit: 0, remaining: 0, reset: 0 })).toBe(0);
  });
});

describe('DashboardStore', () => {
  it('starts empty and idle', () => {
    expect(makeStore(stubClient()).getSnapshot()).toEqual({
      prs: [],
      loading: false,
      error: undefined,
      bodyError: undefined,
      selected: [],
      droppedFromSelection: 0,
      actionRun: undefined,
      searchRateLimit: undefined,
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
    const store = await loaded(client);
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

  describe('refresh', () => {
    it('searches the viewer, and only the viewer, by default', async() => {
      const client = stubClient();
      const store = await loaded(client);

      expect(client.searchPrs).toHaveBeenCalledTimes(1);
      const [ query, page, perPage, owner ] = client.searchPrs.mock.calls[0] ?? [];
      expect(query).toContain('user:rubensworks');
      expect(page).toBe(1);
      expect(perPage).toBe(PAGE_SIZE);
      expect(owner).toBeUndefined();
      expect(store.getSnapshot().prs).toHaveLength(1);
      expect(store.getSnapshot().loading).toBe(false);
      store.dispose();
    });

    it('reports both quotas, since search is metered on its own', async() => {
      const client = stubClient();
      const store = await loaded(client);
      expect(store.getSnapshot().rateLimit).toEqual(QUOTA);
      expect(store.getSnapshot().searchRateLimit).toEqual(SEARCH_QUOTA);
      store.dispose();
    });

    it('fills each row in from its own detail and checks', async() => {
      const client = stubClient();
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'completed', conclusion: 'failure', details_url: 'https://ci' },
      ]});
      const store = await loaded(client);

      const [ row ] = store.getSnapshot().prs;
      expect(row?.detailLoaded).toBe(true);
      expect(row?.branch).toBe('renovate/lodash-4.x');
      expect(row?.headSha).toBe('deadbeef');
      expect(row?.mergeable).toBe('MERGEABLE');
      expect(row?.checkState).toBe('failure');
      expect(client.getCheckRuns).toHaveBeenCalledWith('rubensworks', 'jbr.js', 'deadbeef');
      store.dispose();
    });

    it('enriches in batches rather than opening a connection per pull request', async() => {
      const client = stubClient();
      const numbers = Array.from({ length: ENRICH_BATCH_SIZE + 2 }, (_unused, index) => index + 1);
      let peak = 0;
      let live = 0;
      client.getPr.mockImplementation(async() => {
        live += 1;
        peak = Math.max(peak, live);
        await Promise.resolve();
        live -= 1;
        return prDetail();
      });
      const store = await loaded(client, numbers);

      expect(client.getPr).toHaveBeenCalledTimes(numbers.length);
      expect(peak).toBeLessThanOrEqual(ENRICH_BATCH_SIZE);
      store.dispose();
    });

    it('keeps a row whose detail could not be read, rather than losing it', async() => {
      const client = stubClient();
      client.getPr.mockRejectedValue(new Error('no access'));
      client.searchPrs.mockResolvedValue(searchPage([ searchItem() ]));
      const store = makeStore(client);
      await store.refresh();

      const [ row ] = store.getSnapshot().prs;
      expect(row).toBeDefined();
      expect(row?.detailLoaded).toBe(true);
      expect(row?.headSha).toBe('');
      expect(store.getSnapshot().error).toBeUndefined();
      store.dispose();
    });

    it('does not look for checks when it never learned the head commit', async() => {
      const client = stubClient();
      client.getPr.mockResolvedValue(prDetail({ head: { ref: 'x' }}));
      const store = await loaded(client);
      expect(client.getCheckRuns).not.toHaveBeenCalled();
      store.dispose();
    });

    it('leaves a row uncoloured when its checks cannot be read', async() => {
      const client = stubClient();
      client.getCheckRuns.mockRejectedValue(new Error('no access'));
      const store = await loaded(client);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('none');
      expect(store.getSnapshot().error).toBeUndefined();
      store.dispose();
    });

    it('carries on when only the commit statuses are unreadable', async() => {
      const client = stubClient();
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'completed', conclusion: 'success', details_url: null },
      ]});
      client.getCombinedStatus.mockRejectedValue(new Error('no access'));
      const store = await loaded(client);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('success');
      store.dispose();
    });
  });

  describe('a refresh while the list is already on screen', () => {
    const ALL = Array.from({ length: PAGE_SIZE + 1 }, (_unused, index) => searchItem({ number: index + 1 }));

    /**
     * A client whose search pages through `items`, and whose checks all pass.
     * @param items The search results to serve.
     */
    function paging(items = ALL): IStubClient {
      const client = stubClient();
      client.searchPrs.mockImplementation(async(_query, page) =>
        searchPage(items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), items.length));
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'completed', conclusion: 'success', details_url: null },
      ]});
      return client;
    }

    /**
     * Every snapshot the store publishes while `work` runs.
     * @param store The store to watch.
     * @param work What to run.
     */
    async function snapshotsDuring(
      store: DashboardStore,
      work: () => Promise<void>,
    ): Promise<{ count: number; blank: number }[]> {
      const seen: { count: number; blank: number }[] = [];
      const unsubscribe = store.subscribe(() => {
        const { prs } = store.getSnapshot();
        seen.push({ count: prs.length, blank: prs.filter(pr => pr.checkState === 'none').length });
      });
      await work();
      unsubscribe();
      return seen;
    }

    it('never drops a row, however many pages the search takes', async() => {
      const client = paging();
      const store = makeStore(client);
      await store.refresh();
      expect(store.getSnapshot().prs).toHaveLength(ALL.length);

      const seen = await snapshotsDuring(store, async() => store.refresh());

      // The old bug: page one of the new pass replaced the list, so this dipped to 50.
      expect(Math.min(...seen.map(entry => entry.count))).toBe(ALL.length);
      store.dispose();
    });

    it('never blanks a row that already had its checks', async() => {
      const client = paging();
      const store = makeStore(client);
      await store.refresh();
      expect(store.getSnapshot().prs.every(pr => pr.checkState === 'success')).toBe(true);

      const seen = await snapshotsDuring(store, async() => store.refresh());

      // The old bug: a re-searched row came back with no checks and rendered grey until its
      // enrichment came round again.
      expect(Math.max(...seen.map(entry => entry.blank))).toBe(0);
      store.dispose();
    });

    it('does not fetch again for a pull request GitHub says has not changed', async() => {
      const client = paging();
      const store = makeStore(client);
      await store.refresh();
      const before = client.getPr.mock.calls.length;
      expect(before).toBe(ALL.length);

      await store.refresh();
      expect(client.getPr).toHaveBeenCalledTimes(before);
      store.dispose();
    });

    it('leaves an unchanged row entirely alone, down to its identity', async() => {
      const client = paging();
      const store = makeStore(client);
      await store.refresh();
      const before = store.getSnapshot().prs[0];

      await store.refresh();
      expect(store.getSnapshot().prs[0]).toBe(before);
      store.dispose();
    });

    it('re-reads a pull request whose update time moved, without blanking it first', async() => {
      const client = paging();
      const store = makeStore(client);
      await store.refresh();
      const before = client.getPr.mock.calls.length;

      const moved = ALL.map((item, index) =>
        (index === 0 ? searchItem({ number: 1, updated_at: '2026-09-01T10:00:00Z' }) : item));
      client.searchPrs.mockImplementation(async(_query, page) =>
        searchPage(moved.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), moved.length));

      const seen = await snapshotsDuring(store, async() => store.refresh());

      expect(client.getPr).toHaveBeenCalledTimes(before + 1);
      expect(Math.max(...seen.map(entry => entry.blank))).toBe(0);
      store.dispose();
    });

    it('still removes a pull request that has been merged or closed', async() => {
      const client = paging();
      const store = makeStore(client);
      await store.refresh();

      const fewer = ALL.slice(1);
      client.searchPrs.mockImplementation(async(_query, page) =>
        searchPage(fewer.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), fewer.length));
      await store.refresh();

      expect(store.getSnapshot().prs).toHaveLength(fewer.length);
      expect(store.getSnapshot().prs.map(pr => pr.id)).not.toContain(id(1));
      store.dispose();
    });

    it('does not claim the dashboard is loading when the refresh is a background one', async() => {
      const client = paging();
      const store = makeStore(client);
      await store.refresh();

      const seen: boolean[] = [];
      const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().loading));
      await store.refresh(true);
      unsubscribe();

      expect(seen).not.toContain(true);
      store.dispose();
    });

    it('still says it is loading for a refresh the user asked for', async() => {
      const client = paging();
      const store = makeStore(client);
      const seen: boolean[] = [];
      store.subscribe(() => seen.push(store.getSnapshot().loading));
      await store.refresh();

      expect(seen).toContain(true);
      expect(store.getSnapshot().loading).toBe(false);
      store.dispose();
    });
  });

  describe('pagination', () => {
    it('asks for another page while a full one keeps coming back', async() => {
      const client = stubClient();
      const full = Array.from({ length: PAGE_SIZE }, (_unused, index) => searchItem({ number: index + 1 }));
      client.searchPrs
        .mockResolvedValueOnce(searchPage(full, PAGE_SIZE + 1))
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 999 }) ], PAGE_SIZE + 1));
      const store = makeStore(client);
      await store.refresh();

      expect(client.searchPrs).toHaveBeenCalledTimes(2);
      expect(client.searchPrs.mock.calls[1]?.[1]).toBe(2);
      expect(store.getSnapshot().prs).toHaveLength(PAGE_SIZE + 1);
      store.dispose();
    });

    it('stops on a page that is not full', async() => {
      const client = stubClient();
      const store = await loaded(client);
      expect(client.searchPrs).toHaveBeenCalledTimes(1);
      store.dispose();
    });

    it('stops once it holds everything GitHub said there was', async() => {
      const client = stubClient();
      const full = Array.from({ length: PAGE_SIZE }, (_unused, index) => searchItem({ number: index + 1 }));
      client.searchPrs.mockResolvedValue(searchPage(full, PAGE_SIZE));
      const store = makeStore(client);
      await store.refresh();
      expect(client.searchPrs).toHaveBeenCalledTimes(1);
      store.dispose();
    });

    it('publishes the first page before the second arrives', async() => {
      const client = stubClient();
      const seen: number[] = [];
      const full = Array.from({ length: PAGE_SIZE }, (_unused, index) => searchItem({ number: index + 1 }));
      client.searchPrs
        .mockResolvedValueOnce(searchPage(full, PAGE_SIZE + 1))
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 999 }) ], PAGE_SIZE + 1));
      const store = makeStore(client);
      store.subscribe(() => {
        seen.push(store.getSnapshot().prs.length);
      });
      await store.refresh();
      expect(seen).toContain(PAGE_SIZE);
      store.dispose();
    });

    it('drops the issues the same endpoint returns alongside the pull requests', async() => {
      const client = stubClient();
      client.searchPrs.mockResolvedValue(searchPage([
        searchItem({ number: 1 }),
        searchItem({ number: 2, pull_request: undefined }),
        null,
      ]));
      const store = makeStore(client);
      await store.refresh();

      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ id(1) ]);
      store.dispose();
    });

    it('copes with a page that reports nothing at all', async() => {
      const client = stubClient();
      client.searchPrs.mockResolvedValue({});
      const store = makeStore(client);
      await store.refresh();
      expect(store.getSnapshot().totalCount).toBe(0);
      expect(store.getSnapshot().prs).toEqual([]);
      store.dispose();
    });
  });

  describe('several accounts', () => {
    it('runs one search per token and merges the results', async() => {
      const client = stubClient();
      client.searchPrs
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 1 }) ]))
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 2 }) ]));
      const store = makeStore(
        client,
        { ...SETTINGS, orgs: [ 'comunica' ]},
        [{ owner: 'comunica', token: 'org' }],
      );
      await store.refresh();

      expect(client.searchPrs).toHaveBeenCalledTimes(2);
      expect(client.searchPrs.mock.calls[0]?.[3]).toBeUndefined();
      expect(client.searchPrs.mock.calls[1]?.[3]).toBe('comunica');
      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ id(1), id(2) ]);
      expect(store.getSnapshot().totalCount).toBe(2);
      store.dispose();
    });

    it('folds an organisation without its own token into the main search', async() => {
      const client = stubClient();
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      await store.refresh();

      expect(client.searchPrs).toHaveBeenCalledTimes(1);
      expect(client.searchPrs.mock.calls[0]?.[0]).toContain('org:comunica');
      store.dispose();
    });
  });

  describe('the search ceiling', () => {
    it('retries a multi-owner search one owner at a time when it is capped', async() => {
      const client = stubClient();
      client.searchPrs
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 9 }) ], 1000))
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 1 }) ], 400))
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 2 }) ], 300));
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      await store.refresh();

      expect(client.searchPrs).toHaveBeenCalledTimes(3);
      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ id(1), id(2) ]);
      expect(store.getSnapshot().totalCount).toBe(700);
      expect(store.getSnapshot().truncated).toEqual([]);
      store.dispose();
    });

    it('warns when a single owner is still over the ceiling after splitting', async() => {
      const client = stubClient();
      client.searchPrs
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 9 }) ], 1000))
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 1 }) ], 1200))
        .mockResolvedValueOnce(searchPage([ searchItem({ number: 2 }) ], 20));
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      await store.refresh();

      expect(store.getSnapshot().truncated).toEqual([{ label: 'rubensworks', count: 1200 }]);
      store.dispose();
    });

    it('warns directly when a single-owner search is capped', async() => {
      const client = stubClient();
      client.searchPrs.mockResolvedValue(searchPage([ searchItem() ], 5000));
      const store = makeStore(client);
      await store.refresh();

      expect(store.getSnapshot().truncated).toEqual([{ label: 'rubensworks', count: 5000 }]);
      store.dispose();
    });

    it('abandons the per-owner retry when a newer refresh starts midway', async() => {
      const client = stubClient();
      const store = makeStore(client, { ...SETTINGS, orgs: [ 'comunica' ]});
      let calls = 0;
      client.searchPrs.mockImplementation(async() => {
        calls += 1;
        if (calls === 2) {
          store.dispose();
        }
        return searchPage([ searchItem() ], calls === 1 ? 1000 : 5);
      });
      await store.refresh();

      expect(calls).toBe(2);
      expect(store.getSnapshot().lastRefreshedAt).toBeUndefined();
    });
  });

  describe('failure', () => {
    it('reports an error and stops loading', async() => {
      const client = stubClient();
      client.searchPrs.mockRejectedValue(new Error('offline'));
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
      expect(client.searchPrs).not.toHaveBeenCalled();
      store.dispose();
    });

    it('ignores a failure belonging to a superseded refresh', async() => {
      const client = stubClient();
      const store = makeStore(client);
      client.searchPrs.mockImplementationOnce(async() => {
        store.dispose();
        throw new Error('stale');
      });
      await store.refresh();

      expect(store.getSnapshot().error).toBeUndefined();
    });

    it('drops a page that lands after a newer refresh started', async() => {
      const client = stubClient();
      const store = makeStore(client);
      client.searchPrs.mockImplementationOnce(async() => {
        store.dispose();
        return searchPage([ searchItem() ]);
      });
      await store.refresh();

      expect(store.getSnapshot().prs).toEqual([]);
    });

    it('drops enrichment that lands after a newer refresh started', async() => {
      const client = stubClient();
      client.searchPrs.mockResolvedValue(searchPage([ searchItem() ]));
      const store = makeStore(client);
      client.getPr.mockImplementationOnce(async() => {
        store.dispose();
        return prDetail();
      });
      await store.refresh();

      expect(store.getSnapshot().prs[0]?.detailLoaded).toBe(false);
      expect(store.getSnapshot().loading).toBe(true);
    });
  });

  describe('loadReviewDecision', () => {
    it('reads the reviews of the row that was opened', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getReviews.mockResolvedValue([{ state: 'APPROVED', user: { login: 'a' }}]);

      await store.loadReviewDecision(id(42));
      expect(client.getReviews).toHaveBeenCalledWith('rubensworks', 'jbr.js', 42);
      expect(store.getSnapshot().prs[0]?.reviewDecision).toBe('APPROVED');
      store.dispose();
    });

    it('touches only the row it was asked about', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      client.getReviews.mockResolvedValue([{ state: 'APPROVED', user: { login: 'a' }}]);

      await store.loadReviewDecision(id(2));
      expect(store.getSnapshot().prs[0]?.reviewDecision).toBeNull();
      expect(store.getSnapshot().prs[1]?.reviewDecision).toBe('APPROVED');
      store.dispose();
    });

    it('asks for nothing about a pull request the list does not hold', async() => {
      const client = stubClient();
      const store = await loaded(client);
      await store.loadReviewDecision('nothing/here#1');
      expect(client.getReviews).not.toHaveBeenCalled();
      store.dispose();
    });

    it('does not ask twice while one request is already out', async() => {
      const client = stubClient();
      const store = await loaded(client);
      let release = (_: unknown[]): void => {};
      client.getReviews.mockImplementationOnce(async() => new Promise((resolve) => {
        release = resolve;
      }));
      const first = store.loadReviewDecision(id(42));
      const second = store.loadReviewDecision(id(42));
      release([]);
      await Promise.all([ first, second ]);

      expect(client.getReviews).toHaveBeenCalledTimes(1);
      store.dispose();
    });

    it('shrugs off a failure, since a row without a decision still lists', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getReviews.mockRejectedValue(new Error('no access'));

      await store.loadReviewDecision(id(42));
      expect(store.getSnapshot().error).toBeUndefined();
      expect(store.getSnapshot().prs[0]?.reviewDecision).toBeNull();
      store.dispose();
    });

    it('drops an answer that arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getReviews.mockImplementationOnce(async() => {
        store.dispose();
        return [{ state: 'APPROVED', user: { login: 'a' }}];
      });

      await store.loadReviewDecision(id(42));
      expect(store.getSnapshot().prs[0]?.reviewDecision).toBeNull();
    });
  });

  describe('selection', () => {
    it('selects and deselects', async() => {
      const store = await loaded(stubClient(), [ 1, 2 ]);
      store.toggleSelection(id(1));
      expect(store.getSnapshot().selected).toEqual([ id(1) ]);
      store.toggleSelection(id(1));
      expect(store.getSnapshot().selected).toEqual([]);
      store.dispose();
    });

    it('ignores anything that is not on the list, and never selects one twice', async() => {
      const store = await loaded(stubClient(), [ 1, 2 ]);
      store.setSelection([ id(1), id(1), 'gone/away#9' ]);
      expect(store.getSnapshot().selected).toEqual([ id(1) ]);
      store.dispose();
    });

    it('survives a refresh, and says how much of it did not', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      store.setSelection([ id(1), id(2) ]);

      client.searchPrs.mockResolvedValue(searchPage([ searchItem({ number: 1 }) ]));
      await store.refresh();

      expect(store.getSnapshot().selected).toEqual([ id(1) ]);
      expect(store.getSnapshot().droppedFromSelection).toBe(1);
      store.dispose();
    });

    it('stops reporting a drop once the selection is touched again', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      store.setSelection([ id(1), id(2) ]);
      client.searchPrs.mockResolvedValue(searchPage([ searchItem({ number: 1 }) ]));
      await store.refresh();

      store.setSelection([ id(1) ]);
      expect(store.getSnapshot().droppedFromSelection).toBe(0);
      store.dispose();
    });
  });

  describe('runActions', () => {
    it('runs the action once per pull request and reports each result', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);

      await store.runActions('approve', store.getSnapshot().prs);

      expect(client.approvePr).toHaveBeenCalledTimes(2);
      const run = store.getSnapshot().actionRun;
      expect(run?.kind).toBe('approve');
      expect(run?.running).toBe(false);
      expect(run?.results.map(result => result.outcome)).toEqual([ 'succeeded', 'succeeded' ]);
      expect(run?.results[0]?.label).toBe('rubensworks/jbr.js#1');
      store.dispose();
    });

    it('records a failure against its own pull request and carries on', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      client.approvePr.mockRejectedValueOnce(new Error('no permission'));

      await store.runActions('approve', store.getSnapshot().prs);

      const run = store.getSnapshot().actionRun;
      expect(run?.results.map(result => result.outcome)).toEqual([ 'failed', 'succeeded' ]);
      expect(run?.results[0]?.message).toBe('no permission');
      expect(run?.stoppedReason).toBeUndefined();
      store.dispose();
    });

    it('gives up after several failures in a row rather than hammering the API', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2, 3, 4, 5 ]);
      client.approvePr.mockRejectedValue(new Error('no permission'));

      await store.runActions('approve', store.getSnapshot().prs);

      expect(client.approvePr).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES);
      expect(store.getSnapshot().actionRun?.stoppedReason).toContain('failures in a row');
      expect(store.getSnapshot().actionRun?.results.at(-1)?.outcome).toBe('pending');
      store.dispose();
    });

    it('stops at once when GitHub asks it to slow down', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2, 3 ]);
      client.approvePr.mockRejectedValue(new HttpError(429, { 'retry-after': '30' }));

      await store.runActions('approve', store.getSnapshot().prs);

      expect(client.approvePr).toHaveBeenCalledTimes(1);
      expect(store.getSnapshot().actionRun?.stoppedReason).toContain('slow down');
      store.dispose();
    });

    it('does not count "nothing to do" as a failure', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2, 3, 4 ]);
      client.getPrBody.mockResolvedValue('no checkbox at all');

      await store.runActions('rebase', store.getSnapshot().prs);

      const run = store.getSnapshot().actionRun;
      expect(run?.results.map(result => result.outcome)).toEqual([ 'skipped', 'skipped', 'skipped', 'skipped' ]);
      expect(run?.stoppedReason).toBeUndefined();
      store.dispose();
    });

    it('re-reads only the pull requests it actually changed', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      client.getPr.mockClear();
      client.getPr.mockResolvedValue(prDetail({ mergeable: false }));

      await store.runActions('approve', [ store.getSnapshot().prs[0]! ]);

      expect(client.getPr).toHaveBeenCalledTimes(1);
      expect(client.getPr).toHaveBeenCalledWith('rubensworks', 'jbr.js', 1);
      expect(store.getSnapshot().prs.find(entry => entry.id === id(1))?.mergeable).toBe('CONFLICTING');
      store.dispose();
    });

    it('drops a pull request that is no longer open', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      client.getPr.mockResolvedValue(prDetail({ state: 'closed' }));

      await store.runActions('merge', [ store.getSnapshot().prs[0]! ]);

      expect(store.getSnapshot().prs.map(entry => entry.id)).toEqual([ id(2) ]);
      store.dispose();
    });

    it('leaves rows alone when the re-read fails, since the writes already reported themselves', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      client.getPr.mockRejectedValue(new Error('refresh failed'));

      await store.runActions('approve', [ store.getSnapshot().prs[0]! ]);

      expect(store.getSnapshot().error).toBeUndefined();
      expect(store.getSnapshot().prs).toHaveLength(2);
      expect(store.getSnapshot().actionRun?.results[0]?.outcome).toBe('succeeded');
      store.dispose();
    });

    it('re-reads nothing when nothing succeeded', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1 ]);
      client.getPr.mockClear();
      client.approvePr.mockRejectedValue(new Error('no'));

      await store.runActions('approve', store.getSnapshot().prs);
      expect(client.getPr).not.toHaveBeenCalled();
      store.dispose();
    });

    it('abandons a run whose store has been replaced partway through', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      client.approvePr.mockImplementationOnce(async() => {
        store.dispose();
      });

      await store.runActions('approve', store.getSnapshot().prs);
      expect(client.approvePr).toHaveBeenCalledTimes(1);
    });

    it('does not re-read after a run whose store was replaced on its last pull request', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1 ]);
      client.getPr.mockClear();
      client.approvePr.mockImplementationOnce(async() => {
        store.dispose();
      });

      await store.runActions('approve', store.getSnapshot().prs);
      expect(client.getPr).not.toHaveBeenCalled();
    });

    it('drops a re-read whose answer arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1, 2 ]);
      client.getPr.mockImplementationOnce(async() => {
        store.dispose();
        return prDetail({ state: 'closed' });
      });

      await store.runActions('approve', [ store.getSnapshot().prs[0]! ]);
      expect(store.getSnapshot().prs).toHaveLength(2);
    });

    it('forgets a finished run when asked', async() => {
      const store = await loaded(stubClient(), [ 1 ]);
      await store.runActions('approve', store.getSnapshot().prs);
      store.clearActionRun();
      expect(store.getSnapshot().actionRun).toBeUndefined();
      store.dispose();
    });
  });

  describe('a merge method a repository refuses', () => {
    it('remembers the next one to try for that repository', async() => {
      const client = stubClient();
      const saved: ISettings[] = [];
      client.searchPrs.mockResolvedValue(searchPage([ searchItem({ number: 1 }) ]));
      const store = makeStore(client, SETTINGS, [], next => saved.push(next));
      await store.refresh();
      client.mergePr.mockRejectedValue(new HttpError(405));

      await store.runActions('merge', store.getSnapshot().prs);

      expect(saved.at(-1)?.repoMergeMethods).toEqual({ 'rubensworks/jbr.js': 'merge' });
      store.dispose();
    });

    it('says nothing when the same refusal happens twice', async() => {
      const client = stubClient();
      const saved: ISettings[] = [];
      client.searchPrs.mockResolvedValue(searchPage([ searchItem({ number: 1 }), searchItem({ number: 2 }) ]));
      const store = makeStore(client, SETTINGS, [], next => saved.push(next));
      await store.refresh();
      client.mergePr.mockRejectedValue(new HttpError(405));

      await store.runActions('merge', store.getSnapshot().prs);
      expect(saved).toHaveLength(1);
      store.dispose();
    });

    it('leaves the settings alone for any other failure', async() => {
      const client = stubClient();
      const saved: ISettings[] = [];
      client.searchPrs.mockResolvedValue(searchPage([ searchItem({ number: 1 }) ]));
      const store = makeStore(client, SETTINGS, [], next => saved.push(next));
      await store.refresh();
      client.mergePr.mockRejectedValue(new Error('offline'));

      await store.runActions('merge', store.getSnapshot().prs);
      expect(saved).toEqual([]);
      store.dispose();
    });

    it('says nothing when nobody is listening for settings changes', async() => {
      const client = stubClient();
      const store = await loaded(client, [ 1 ]);
      client.mergePr.mockRejectedValue(new HttpError(405));

      await store.runActions('merge', store.getSnapshot().prs);
      expect(store.getSnapshot().actionRun?.results[0]?.outcome).toBe('failed');
      store.dispose();
    });
  });

  describe('polling', () => {
    async function started(client: IStubClient, numbers: number[] = [ 42 ]): Promise<DashboardStore> {
      const store = await loaded(client, numbers);
      store.start();
      return store;
    }

    it('re-runs the whole search once the idle interval has passed', async() => {
      const client = stubClient();
      const store = await started(client);
      const before = client.searchPrs.mock.calls.length;

      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS + TICK_MS);
      expect(client.searchPrs.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('does nothing at all before then', async() => {
      const client = stubClient();
      const store = await started(client);
      const before = client.searchPrs.mock.calls.length;

      await vi.advanceTimersByTimeAsync(TICK_MS * 5);
      expect(client.searchPrs).toHaveBeenCalledTimes(before);
      store.dispose();
    });

    it('re-reads a pending pull request far more often than the whole search', async() => {
      const client = stubClient();
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'in_progress', conclusion: null, details_url: null },
      ]});
      const store = await started(client);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('pending');
      const before = client.getCheckRuns.mock.calls.length;

      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS + TICK_MS);
      expect(client.getCheckRuns.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('leaves a settled pull request alone for far longer than a running one', async() => {
      const client = stubClient();
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'completed', conclusion: 'success', details_url: null },
      ]});
      const store = await started(client);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('success');
      const before = client.getCheckRuns.mock.calls.length;

      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS * 2);
      expect(client.getCheckRuns).toHaveBeenCalledTimes(before);

      await vi.advanceTimersByTimeAsync(SETTLED_POLL_MS);
      expect(client.getCheckRuns.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('leaves a pull request whose detail never loaded out of the rotation', async() => {
      const client = stubClient();
      client.getPr.mockRejectedValue(new Error('gone'));
      const store = await started(client);
      expect(store.getSnapshot().prs.length).toBeGreaterThan(0);
      const before = client.getCheckRuns.mock.calls.length;

      // Its checks have never been read, so there is nothing to re-read: only a refresh can get
      // it out of this state, and the rotation must not spend requests trying.
      await vi.advanceTimersByTimeAsync(SETTLED_POLL_MS);
      expect(client.getCheckRuns).toHaveBeenCalledTimes(before);
      store.dispose();
    });

    it('does not hammer a pull request whose checks cannot be read', async() => {
      const client = stubClient();
      client.getCheckRuns.mockRejectedValue(new Error('no access'));
      const store = await started(client);
      const before = client.getCheckRuns.mock.calls.length;

      // A repository the token cannot read checks for would otherwise be permanently due, and so
      // asked about on every single tick until the quota ran out.
      await vi.advanceTimersByTimeAsync(TICK_MS * 5);
      expect(client.getCheckRuns).toHaveBeenCalledTimes(before);

      await vi.advanceTimersByTimeAsync(SETTLED_POLL_MS);
      expect(client.getCheckRuns.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('leaves settled pull requests alone', async() => {
      const client = stubClient();
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'completed', conclusion: 'success', details_url: null },
      ]});
      const store = await started(client);
      const before = client.getCheckRuns.mock.calls.length;

      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS * 2);
      expect(client.getCheckRuns).toHaveBeenCalledTimes(before);
      store.dispose();
    });

    it('does not poll while the tab is hidden', async() => {
      const client = stubClient();
      const store = await started(client);
      const before = client.searchPrs.mock.calls.length;

      hide(true);
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
      expect(client.searchPrs).toHaveBeenCalledTimes(before);
      expect(store.getSnapshot().paused).toBe(true);

      hide(false);
      await vi.advanceTimersByTimeAsync(TICK_MS * 2);
      expect(client.searchPrs.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('slows down as the quota drains, and stops short of spending it all', async() => {
      const client = stubClient();
      client.rateLimit = { ...QUOTA, remaining: 10 };
      const store = await started(client);
      const before = client.searchPrs.mock.calls.length;

      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
      expect(client.searchPrs).toHaveBeenCalledTimes(before);
      expect(store.getSnapshot().backoffReason).toContain('quota nearly spent');
      store.dispose();
    });

    it('polls less often, rather than not at all, on a merely low quota', async() => {
      const client = stubClient();
      client.rateLimit = { ...QUOTA, remaining: 400 };
      const store = await started(client);
      const before = client.searchPrs.mock.calls.length;

      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
      expect(client.searchPrs).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 4);
      expect(client.searchPrs.mock.calls.length).toBeGreaterThan(before);
      store.dispose();
    });

    it('starting twice does not start twice', async() => {
      const client = stubClient();
      const store = await started(client);
      store.start();
      const before = client.searchPrs.mock.calls.length;
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS + TICK_MS);
      expect(client.searchPrs).toHaveBeenCalledTimes(before + 1);
      store.dispose();
    });

    it('stops polling once disposed', async() => {
      const client = stubClient();
      const store = await started(client);
      store.dispose();
      const before = client.searchPrs.mock.calls.length;
      await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 3);
      expect(client.searchPrs).toHaveBeenCalledTimes(before);
    });
  });

  describe('pollChecks', () => {
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
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'completed', conclusion: 'success', details_url: 'https://ci/1' },
        { name: 'lint', status: 'completed', conclusion: 'failure', details_url: null },
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
      const store = await loaded(client, [ 1, 2 ]);
      const before = store.getSnapshot().prs;
      client.getCheckRuns
        .mockResolvedValueOnce({ notModified: false, runs: [
          { name: 'build', status: 'completed', conclusion: 'failure', details_url: null },
        ]})
        .mockResolvedValueOnce({ notModified: true, runs: []});

      await store.pollChecks(before);

      const after = store.getSnapshot().prs;
      expect(after[0]?.checkState).toBe('failure');
      expect(after[1]).toBe(before[1]);
      store.dispose();
    });

    it('keeps the check runs when only the commit statuses are unreadable', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: [
        { name: 'build', status: 'completed', conclusion: 'failure', details_url: null },
      ]});
      client.getCombinedStatus.mockRejectedValue(new Error('no access'));

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('failure');
      store.dispose();
    });

    it('shrugs off one repository it cannot read', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getCheckRuns.mockRejectedValue(new Error('no access'));

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().error).toBeUndefined();
      expect(store.getSnapshot().backoffUntil).toBeUndefined();
      store.dispose();
    });

    it('backs off, and says so, when GitHub asks it to slow down', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getCheckRuns.mockRejectedValue(new HttpError(429, { 'retry-after': '30' }));

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().backoffReason).toBe('GitHub asked us to slow down');
      expect(store.getSnapshot().backoffUntil).toBeGreaterThan(Date.now());
      store.dispose();
    });

    it('drops an answer that arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getCheckRuns.mockImplementationOnce(async() => {
        store.dispose();
        return { notModified: false, runs: []};
      });

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('none');
    });

    it('drops a failure that arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getCheckRuns.mockImplementationOnce(async() => {
        store.dispose();
        throw new HttpError(429);
      });

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().backoffReason).toBeUndefined();
    });

    it('drops a status answer that arrives after the store was replaced', async() => {
      const client = stubClient();
      const store = await loaded(client);
      client.getCheckRuns.mockResolvedValue({ notModified: false, runs: []});
      client.getCombinedStatus.mockImplementationOnce(async() => {
        store.dispose();
        return { statuses: []};
      });

      await store.pollChecks(store.getSnapshot().prs);
      expect(store.getSnapshot().prs[0]?.checkState).toBe('none');
    });
  });

  describe('configure', () => {
    it('changes what the next refresh looks at without blanking the rows', async() => {
      const client = stubClient();
      const store = await loaded(client);
      const before = store.getSnapshot().prs;

      store.configure({ ...SETTINGS, orgs: [ 'comunica' ]}, []);
      expect(store.getSnapshot().prs).toBe(before);

      await store.refresh();
      expect(client.searchPrs.mock.calls.at(-1)?.[0]).toContain('org:comunica');
      store.dispose();
    });
  });
});
