import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTERS } from '../src/lib/selectors';
import type { IViewState } from '../src/lib/urlState';
import { DEFAULT_VIEW, readViewState, toHash, writeViewState } from '../src/lib/urlState';

const FULL: IViewState = {
  group: 'dependency',
  sort: 'status',
  groupSort: 'name',
  filters: {
    query: 'lodash',
    onlyFailing: true,
    onlyPassing: true,
    onlyConflicting: true,
    onlyMergeable: true,
    hideDrafts: true,
    onlyMergeableByMe: true,
    owner: 'comunica',
    updateType: 'major',
    manager: 'npm',
    depType: 'devDependencies',
  },
  collapsed: [ 'lodash', 'types-node' ],
};

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('readViewState', () => {
  it('returns the defaults for an empty fragment', () => {
    expect(readViewState('')).toEqual(DEFAULT_VIEW);
    expect(readViewState('#')).toEqual(DEFAULT_VIEW);
  });

  it('reads a fragment with or without its leading hash', () => {
    expect(readViewState('#g=repo').group).toBe('repo');
    expect(readViewState('g=repo').group).toBe('repo');
  });

  it('ignores values it does not recognise', () => {
    expect(readViewState('#g=sideways&s=vibes&gs=nope')).toEqual(DEFAULT_VIEW);
  });

  it('reads an empty collapsed list as none collapsed', () => {
    expect(readViewState('#c=').collapsed).toEqual([]);
  });
});

describe('toHash', () => {
  it('writes nothing at all for the default view', () => {
    expect(toHash(DEFAULT_VIEW)).toBe('');
  });

  it('omits every filter that is off', () => {
    expect(toHash({ ...DEFAULT_VIEW, group: 'repo' })).toBe('#g=repo');
  });

  it('round-trips a fully populated view', () => {
    expect(readViewState(toHash(FULL))).toEqual(FULL);
  });

  it('round-trips a query with characters that need escaping', () => {
    const view = { ...DEFAULT_VIEW, filters: { ...EMPTY_FILTERS, query: '@types/node & co' }};
    expect(readViewState(toHash(view)).filters.query).toBe('@types/node & co');
  });

  it('keeps the bookmarkable case short', () => {
    const view: IViewState = {
      ...DEFAULT_VIEW,
      group: 'dependency',
      filters: { ...EMPTY_FILTERS, onlyFailing: true },
    };
    expect(toHash(view)).toBe('#g=dependency&failing=1');
  });
});

describe('writeViewState', () => {
  it('puts the view in the address bar without adding a history entry', () => {
    const before = history.length;
    writeViewState({ ...DEFAULT_VIEW, group: 'repo' });
    expect(location.hash).toBe('#g=repo');
    expect(history.length).toBe(before);
  });

  it('clears the fragment when the view returns to its default', () => {
    writeViewState({ ...DEFAULT_VIEW, group: 'repo' });
    writeViewState(DEFAULT_VIEW);
    expect(location.hash).toBe('');
  });

  it('does nothing when the address bar already says so', () => {
    writeViewState({ ...DEFAULT_VIEW, group: 'repo' });
    const before = history.length;
    writeViewState({ ...DEFAULT_VIEW, group: 'repo' });
    expect(history.length).toBe(before);
    expect(location.hash).toBe('#g=repo');
  });
});
