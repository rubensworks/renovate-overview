import { describe, expect, it } from 'vitest';
import type { IFilters } from '../src/lib/selectors';
import {
  CHECK_STATE_SEVERITY,
  EMPTY_FILTERS,
  UNRECOGNISED_KEY,
  countByState,
  depTypesOf,
  filterPrs,
  greenIn,
  groupPrs,
  managersOf,
  matchesFilters,
  ownersOf,
  searchableText,
  sortGroups,
  sortPrs,
  updateTypesPresent,
  worstState,
} from '../src/lib/selectors';
import type { IRenovatePr } from '../src/lib/types';
import { pr } from './fixtures';

function withFilters(overrides: Partial<IFilters>): IFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

const LODASH = pr({ id: 'a', title: 'Update dependency lodash to v4.17.21', branch: 'renovate/lodash-4.x' });
const TYPES_NODE = pr({
  id: 'b',
  repo: 'comunica/comunica',
  owner: 'comunica',
  number: 7,
  title: 'Update dependency @types/node to v20.11.5',
  branch: 'renovate/types-node-20.x',
  checkState: 'failure',
});
const GROUP = pr({
  id: 'c',
  repo: 'solid/spec',
  owner: 'solid',
  title: 'Update all non-major dependencies',
  branch: 'renovate/all-minor-patch',
  checkState: 'pending',
  parse: {
    updates: [
      { depName: 'lodash', groupKey: 'lodash', updateType: 'patch', source: 'body' },
      { depName: '@types/node', groupKey: 'types-node', updateType: 'patch', source: 'body' },
    ],
    isGroupPr: true,
    groupName: 'all non-major dependencies',
    updateType: 'patch',
    source: 'body',
    disagreements: [],
  },
});
const UNKNOWN = pr({ id: 'd', title: 'Merge branch master into develop', branch: 'feature/x' });

describe('countByState', () => {
  it('counts nothing as nothing', () => {
    expect(countByState([])).toEqual({ success: 0, failure: 0, pending: 0, error: 0, none: 0 });
  });

  it('counts one per state', () => {
    expect(countByState([ LODASH, TYPES_NODE, GROUP ]))
      .toEqual({ success: 1, failure: 1, pending: 1, error: 0, none: 0 });
  });
});

describe('worstState', () => {
  it('is none when there is nothing to judge', () => {
    expect(worstState([])).toBe('none');
  });

  it('lets one failure speak for the whole group', () => {
    expect(worstState([ LODASH, TYPES_NODE ])).toBe('failure');
    expect(worstState([ LODASH, GROUP ])).toBe('pending');
    expect(worstState([ LODASH ])).toBe('success');
  });

  it('ranks an errored check with the failures rather than with the passes', () => {
    expect(CHECK_STATE_SEVERITY.error).toBeLessThan(CHECK_STATE_SEVERITY.pending);
  });
});

describe('searchableText', () => {
  it('covers the repository, title, branch and dependency names', () => {
    const text = searchableText(GROUP);
    expect(text).toContain('solid/spec');
    expect(text).toContain('all non-major dependencies');
    expect(text).toContain('renovate/all-minor-patch');
    expect(text).toContain('@types/node');
  });
});

describe('matchesFilters', () => {
  it('keeps everything by default', () => {
    expect(matchesFilters(LODASH, EMPTY_FILTERS)).toBe(true);
  });

  it('matches the free-text query case-insensitively across every field', () => {
    expect(matchesFilters(TYPES_NODE, withFilters({ query: 'COMUNICA' }))).toBe(true);
    expect(matchesFilters(TYPES_NODE, withFilters({ query: 'types/node' }))).toBe(true);
    expect(matchesFilters(TYPES_NODE, withFilters({ query: 'renovate/types' }))).toBe(true);
    expect(matchesFilters(TYPES_NODE, withFilters({ query: 'lodash' }))).toBe(false);
  });

  it('ignores a query that is only whitespace', () => {
    expect(matchesFilters(LODASH, withFilters({ query: '   ' }))).toBe(true);
  });

  it('counts an errored check as failing', () => {
    expect(matchesFilters(TYPES_NODE, withFilters({ onlyFailing: true }))).toBe(true);
    expect(matchesFilters(pr({ checkState: 'error' }), withFilters({ onlyFailing: true }))).toBe(true);
    expect(matchesFilters(LODASH, withFilters({ onlyFailing: true }))).toBe(false);
  });

  it('filters on passing', () => {
    expect(matchesFilters(LODASH, withFilters({ onlyPassing: true }))).toBe(true);
    expect(matchesFilters(TYPES_NODE, withFilters({ onlyPassing: true }))).toBe(false);
  });

  it('filters on mergeability, in both directions', () => {
    const conflicting = pr({ mergeable: 'CONFLICTING' });
    expect(matchesFilters(conflicting, withFilters({ onlyConflicting: true }))).toBe(true);
    expect(matchesFilters(LODASH, withFilters({ onlyConflicting: true }))).toBe(false);
    expect(matchesFilters(LODASH, withFilters({ onlyMergeable: true }))).toBe(true);
    expect(matchesFilters(conflicting, withFilters({ onlyMergeable: true }))).toBe(false);
  });

  it('hides drafts', () => {
    expect(matchesFilters(pr({ isDraft: true }), withFilters({ hideDrafts: true }))).toBe(false);
    expect(matchesFilters(LODASH, withFilters({ hideDrafts: true }))).toBe(true);
  });

  it('filters on what the viewer could merge', () => {
    expect(matchesFilters(LODASH, withFilters({ onlyMergeableByMe: true }))).toBe(true);
    expect(matchesFilters(pr({ viewerCanMerge: false }), withFilters({ onlyMergeableByMe: true })))
      .toBe(false);
  });

  it('filters by owner, ignoring case', () => {
    expect(matchesFilters(TYPES_NODE, withFilters({ owner: 'COMUNICA' }))).toBe(true);
    expect(matchesFilters(LODASH, withFilters({ owner: 'comunica' }))).toBe(false);
  });

  it('filters by update type, looking at the packages as well as the pull request', () => {
    expect(matchesFilters(GROUP, withFilters({ updateType: 'patch' }))).toBe(true);
    expect(matchesFilters(GROUP, withFilters({ updateType: 'major' }))).toBe(false);
  });

  it('filters by manager and by dependency type', () => {
    const action = pr({ title: 'Update actions/checkout action to v4', branch: '' });
    expect(matchesFilters(action, withFilters({ manager: 'github-actions' }))).toBe(true);
    expect(matchesFilters(LODASH, withFilters({ manager: 'github-actions' }))).toBe(false);

    const typed = pr({ parse: { ...GROUP.parse, updates: [
      { depName: 'x', groupKey: 'x', updateType: 'patch', depType: 'devDependencies', source: 'body' },
    ]}});
    expect(matchesFilters(typed, withFilters({ depType: 'devDependencies' }))).toBe(true);
    expect(matchesFilters(typed, withFilters({ depType: 'dependencies' }))).toBe(false);
  });
});

describe('filterPrs', () => {
  it('applies the filters to a list', () => {
    expect(filterPrs([ LODASH, TYPES_NODE ], withFilters({ onlyFailing: true }))).toEqual([ TYPES_NODE ]);
  });
});

describe('sortPrs', () => {
  const older = pr({
    id: '1',
    number: 3,
    repo: 'z/z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  const newer = pr({
    id: '2',
    number: 1,
    repo: 'a/a',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  });

  it('puts the most recently updated first by default', () => {
    expect(sortPrs([ older, newer ], 'updated').map(entry => entry.id)).toEqual([ '2', '1' ]);
  });

  it('sorts by creation, repository and number', () => {
    expect(sortPrs([ older, newer ], 'created').map(entry => entry.id)).toEqual([ '2', '1' ]);
    expect(sortPrs([ older, newer ], 'repo').map(entry => entry.id)).toEqual([ '2', '1' ]);
    expect(sortPrs([ older, newer ], 'number').map(entry => entry.id)).toEqual([ '2', '1' ]);
  });

  it('keeps an owner together rather than splitting it on capitalisation', () => {
    const upper = pr({ id: 'u', repo: 'Comunica/zzz' });
    const lower = pr({ id: 'l', repo: 'comunica/aaa' });
    expect(sortPrs([ upper, lower ], 'repo').map(entry => entry.id)).toEqual([ 'l', 'u' ]);
  });

  it('sorts failing first', () => {
    expect(sortPrs([ LODASH, TYPES_NODE, GROUP ], 'status').map(entry => entry.id))
      .toEqual([ 'b', 'c', 'a' ]);
  });

  it('sorts by dependency name, falling back to the group name and then to nothing', () => {
    const unloadedGroup = pr({
      id: 'z',
      title: 'Update all non-major dependencies',
      branch: 'renovate/all-minor-patch',
    });
    // 'a' is the unrecognised one, which has no name at all to sort on.
    expect(sortPrs([ TYPES_NODE, LODASH, GROUP, unloadedGroup, UNKNOWN ], 'dependency')
      .map(entry => entry.id))
      .toEqual([ 'd', 'b', 'z', 'a', 'c' ]);
  });

  it('sorts major before patch', () => {
    const major = pr({ id: 'M', title: 'Update dependency foo to v2 (major)', branch: '' });
    const patch = pr({ id: 'P', title: 'Update dependency foo to v1.0.1 (patch)', branch: '' });
    expect(sortPrs([ patch, major ], 'update-type').map(entry => entry.id)).toEqual([ 'M', 'P' ]);
  });

  it('is stable across refreshes, resolving ties by update time and then by URL', () => {
    const left = pr({ id: 'x', url: 'https://b', repo: 'same/same', updatedAt: '2026-01-01T00:00:00Z' });
    const right = pr({ id: 'y', url: 'https://a', repo: 'same/same', updatedAt: '2026-01-01T00:00:00Z' });
    expect(sortPrs([ left, right ], 'repo').map(entry => entry.id)).toEqual([ 'y', 'x' ]);
    expect(sortPrs([ right, left ], 'repo').map(entry => entry.id)).toEqual([ 'y', 'x' ]);
  });

  it('does not modify the list it was given', () => {
    const input: IRenovatePr[] = [ older, newer ];
    sortPrs(input, 'repo');
    expect(input.map(entry => entry.id)).toEqual([ '1', '2' ]);
  });
});

describe('groupPrs', () => {
  it('groups into nothing when grouping is off', () => {
    expect(groupPrs([ LODASH ], 'none')).toEqual([]);
  });

  it('groups by repository and by owner', () => {
    expect(groupPrs([ LODASH, TYPES_NODE ], 'repo').map(group => group.label))
      .toEqual([ 'rubensworks/jbr.js', 'comunica/comunica' ]);
    expect(groupPrs([ LODASH, TYPES_NODE ], 'owner').map(group => group.label))
      .toEqual([ 'rubensworks', 'comunica' ]);
  });

  it('groups by update type', () => {
    expect(groupPrs([ GROUP ], 'update-type').map(group => group.label)).toEqual([ 'patch' ]);
  });

  it('puts a group pull request in every dependency it touches', () => {
    const groups = groupPrs([ LODASH, TYPES_NODE, GROUP ], 'dependency');
    const byKey = new Map(groups.map(group => [ group.key, group ]));
    expect(byKey.get('lodash')?.prs.map(entry => entry.id)).toEqual([ 'a', 'c' ]);
    expect(byKey.get('types-node')?.prs.map(entry => entry.id)).toEqual([ 'b', 'c' ]);
  });

  it('never counts one pull request twice within a group', () => {
    const twice = pr({ id: 'twice', parse: { ...GROUP.parse, updates: [
      { depName: 'lodash', groupKey: 'lodash', updateType: 'patch', source: 'body' },
      { depName: 'Lodash', groupKey: 'lodash', updateType: 'minor', source: 'body' },
    ]}});
    const [ group ] = groupPrs([ twice ], 'dependency');
    expect(group?.prs).toHaveLength(1);
    expect(group?.counts.success).toBe(1);
  });

  it('files a group whose body has not loaded under its own name', () => {
    const unloaded = pr({ title: 'Update all non-major dependencies', branch: 'renovate/all-minor-patch' });
    expect(groupPrs([ unloaded ], 'dependency').map(group => group.label))
      .toEqual([ 'all non-major dependencies' ]);
  });

  it('never drops a pull request it cannot parse', () => {
    const [ group ] = groupPrs([ UNKNOWN ], 'dependency');
    expect(group?.key).toBe(UNRECOGNISED_KEY);
    expect(group?.prs).toEqual([ UNKNOWN ]);
  });

  it('rolls each group up into a breakdown and a worst state', () => {
    const [ group ] = groupPrs([ LODASH, TYPES_NODE ], 'owner');
    expect(group?.counts.success).toBe(1);
    expect(group?.worst).toBe('success');
  });
});

describe('sortGroups', () => {
  const groups = groupPrs([ LODASH, TYPES_NODE, GROUP, UNKNOWN ], 'dependency');

  it('puts the biggest group first', () => {
    const uneven = groupPrs([
      LODASH,
      pr({ id: 'e', repo: 'comunica/other', owner: 'comunica' }),
      TYPES_NODE,
    ], 'owner');
    expect(sortGroups(uneven, 'size').map(group => [ group.label, group.prs.length ]))
      .toEqual([[ 'comunica', 2 ], [ 'rubensworks', 1 ]]);
  });

  it('sorts by name and by worst status', () => {
    expect(sortGroups(groups, 'name').map(group => group.label))
      .toEqual([ '@types/node', 'lodash', 'Unrecognised' ]);
    expect(sortGroups(groups, 'status')[0]?.label).toBe('@types/node');
  });

  it('always sinks the unrecognised group to the bottom, wherever it started', () => {
    for (const key of <const> [ 'size', 'name', 'status' ]) {
      expect(sortGroups(groups, key).at(-1)?.key).toBe(UNRECOGNISED_KEY);
      expect(sortGroups([ ...groups ].reverse(), key).at(-1)?.key).toBe(UNRECOGNISED_KEY);
    }
  });

  it('falls back to the name when sizes or statuses tie', () => {
    const tied = groupPrs([ LODASH, TYPES_NODE ], 'repo');
    expect(sortGroups(tied, 'size').map(group => group.label))
      .toEqual([ 'comunica/comunica', 'rubensworks/jbr.js' ]);
  });
});

describe('the filter option lists', () => {
  it('lists the owners, sorted and without repeats', () => {
    expect(ownersOf([ LODASH, TYPES_NODE, LODASH ])).toEqual([ 'comunica', 'rubensworks' ]);
  });

  it('lists the managers actually present', () => {
    const action = pr({ title: 'Update actions/checkout action to v4', branch: '' });
    expect(managersOf([ LODASH, action ])).toEqual([ 'github-actions' ]);
  });

  it('lists the dependency types actually present', () => {
    expect(depTypesOf([ LODASH ])).toEqual([]);
    const typed = pr({ parse: { ...GROUP.parse, updates: [
      { depName: 'x', groupKey: 'x', updateType: 'patch', depType: 'devDependencies', source: 'body' },
    ]}});
    expect(depTypesOf([ typed ])).toEqual([ 'devDependencies' ]);
  });

  it('lists the update types actually present', () => {
    expect(updateTypesPresent([ GROUP ])).toEqual([ 'patch' ]);
  });
});

describe('greenIn', () => {
  it('keeps only what is passing, not draft and not conflicting', () => {
    const draft = pr({ id: 'draft', isDraft: true });
    const conflicting = pr({ id: 'conflict', mergeable: 'CONFLICTING' });
    expect(greenIn([ LODASH, TYPES_NODE, draft, conflicting ]).map(entry => entry.id)).toEqual([ 'a' ]);
  });
});
