import { describe, expect, it } from 'vitest';
import { normalizeKey, resolveUpdates } from '../../src/lib/renovate/resolve';
import { pr } from '../fixtures';
import { DEFAULT_BODY, GROUP_BODY } from './bodies';
import { BRANCH_CASES } from './branches';
import { TITLE_CASES } from './titles';

describe('normalizeKey', () => {
  it('lowercases', () => {
    expect(normalizeKey('Lodash')).toBe('lodash');
  });

  it('makes a scoped npm package and its branch spelling the same key', () => {
    expect(normalizeKey('@types/node')).toBe(normalizeKey('types-node'));
    expect(normalizeKey('@sentry/cli')).toBe('sentry-cli');
  });

  it('makes an action and its branch spelling the same key', () => {
    expect(normalizeKey('actions/checkout')).toBe(normalizeKey('actions-checkout'));
  });

  it('keeps a dotted or colon-separated name readable', () => {
    expect(normalizeKey('node.js')).toBe('node-js');
    expect(normalizeKey('com.google.guava:guava')).toBe('com-google-guava-guava');
  });

  it('collapses runs of separators and trims them from the ends', () => {
    expect(normalizeKey('--foo//bar--')).toBe('foo-bar');
  });

  it('has nothing to say about an empty name', () => {
    expect(normalizeKey('')).toBe('');
  });
});

describe('resolveUpdates', () => {
  it('prefers the body over the title', () => {
    const resolved = resolveUpdates(pr({ title: 'Update dependency lodash to v4' }), DEFAULT_BODY);
    expect(resolved.source).toBe('body');
    expect(resolved.updates.map(update => update.depName)).toEqual([ '@sentry/cli' ]);
  });

  it('prefers the title over the branch', () => {
    const resolved = resolveUpdates(pr({
      title: 'Update dependency lodash to v4.17.21',
      branch: 'renovate/lodash-4.x',
    }));
    expect(resolved.source).toBe('title');
    expect(resolved.updates[0]?.depName).toBe('lodash');
  });

  it('falls back to the branch when the title says nothing', () => {
    const resolved = resolveUpdates(pr({
      title: 'Merge branch master into develop',
      branch: 'renovate/lodash-4.x',
    }));
    expect(resolved.source).toBe('branch');
    expect(resolved.updates[0]?.depName).toBe('lodash');
  });

  it('resolves to unrecognised rather than guessing, and still yields a pull request', () => {
    const resolved = resolveUpdates(pr({ title: 'Merge branch master into develop', branch: 'feature/x' }));
    expect(resolved.source).toBe('unknown');
    expect(resolved.updates).toEqual([]);
    expect(resolved.isGroupPr).toBe(false);
  });

  it('records a disagreement between the sources without hiding it', () => {
    const resolved = resolveUpdates(pr({
      title: 'Update dependency lodash to v4.17.21',
      branch: 'renovate/types-node-20.x',
    }));
    expect(resolved.source).toBe('title');
    expect(resolved.disagreements).toEqual([
      'branch says types-node, title says lodash',
    ]);
  });

  it('says nothing about a disagreement when the sources agree', () => {
    const resolved = resolveUpdates(pr({
      title: 'Update dependency @types/node to v20.11.5',
      branch: 'renovate/types-node-20.x',
    }));
    expect(resolved.disagreements).toEqual([]);
  });

  it('borrows the branch update type when the title does not state one', () => {
    const resolved = resolveUpdates(pr({
      title: 'Update jest monorepo to v29',
      branch: 'renovate/major-jest-monorepo',
    }));
    expect(resolved.updateType).toBe('major');
  });

  it('lets a group body flesh out what the title only named', () => {
    const resolved = resolveUpdates(pr({
      title: 'Update all non-major dependencies',
      branch: 'renovate/all-minor-patch',
    }), GROUP_BODY);
    expect(resolved.isGroupPr).toBe(true);
    expect(resolved.updates).toHaveLength(8);
    expect(resolved.groupName).toBe('all non-major dependencies');
  });

  it('keeps a group flagged as one even when the body has not been loaded', () => {
    const resolved = resolveUpdates(pr({
      title: 'Update all non-major dependencies',
      branch: 'renovate/all-minor-patch',
    }));
    expect(resolved.isGroupPr).toBe(true);
    expect(resolved.updates).toEqual([]);
  });

  it('falls back through the sources when a body carries no table', () => {
    const resolved = resolveUpdates(pr({ title: 'Update dependency lodash to v4.17.21' }), 'no table here');
    expect(resolved.source).toBe('title');
    expect(resolved.updates[0]?.depName).toBe('lodash');
  });
});

describe('the whole fixture set', () => {
  it('resolves every title to something, and throws on none of them', () => {
    for (const testCase of TITLE_CASES) {
      const resolved = resolveUpdates(pr({ title: testCase.title, branch: '' }));
      expect(resolved).toBeDefined();
      expect(Array.isArray(resolved.updates)).toBe(true);
      for (const update of resolved.updates) {
        expect(update.depName.length).toBeGreaterThan(0);
        expect(update.groupKey.length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every branch to something, and throws on none of them', () => {
    for (const testCase of BRANCH_CASES) {
      const resolved = resolveUpdates(pr({ title: '', branch: testCase.branch }));
      expect(resolved).toBeDefined();
      for (const update of resolved.updates) {
        expect(update.groupKey.length).toBeGreaterThan(0);
      }
    }
  });

  it('produces a grouping key for every dependency it names, in every combination', () => {
    for (const titleCase of TITLE_CASES) {
      for (const branchCase of BRANCH_CASES) {
        const resolved = resolveUpdates(pr({ title: titleCase.title, branch: branchCase.branch }));
        for (const update of resolved.updates) {
          expect(update.groupKey).toBe(normalizeKey(update.depName));
        }
      }
    }
  });
});
