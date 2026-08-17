import { describe, expect, it } from 'vitest';
import { parseBranch } from '../../src/lib/renovate/parseBranch';
import { BRANCH_CASES } from './branches';

describe('parseBranch', () => {
  describe.each(BRANCH_CASES)('$branch', (testCase) => {
    const parsed = parseBranch(testCase.branch);

    it('never throws', () => {
      expect(parsed).toBeDefined();
    });

    if (testCase.depName !== undefined) {
      it('reads the dependency slug', () => {
        expect(parsed.updates[0]?.depName).toBe(testCase.depName);
      });
    }

    if (testCase.groupKey !== undefined) {
      it('normalises the grouping key', () => {
        expect(parsed.updates[0]?.groupKey).toBe(testCase.groupKey);
      });
    }

    if (testCase.newVersion !== undefined) {
      it('reads the version', () => {
        expect(parsed.updates[0]?.newVersion).toBe(testCase.newVersion);
      });
    }

    if (testCase.updateType !== undefined) {
      it('reads the update type', () => {
        expect(parsed.updates[0]?.updateType ?? parsed.updateType).toBe(testCase.updateType);
      });
    }

    if (testCase.isGroup !== undefined) {
      it('knows whether it is a group', () => {
        expect(parsed.isGroupPr).toBe(testCase.isGroup);
      });
    }

    if (testCase.manager !== undefined) {
      it('hints at the manager', () => {
        expect(parsed.updates[0]?.manager).toBe(testCase.manager);
      });
    }
  });

  it('marks everything it produces as coming from the branch', () => {
    for (const testCase of BRANCH_CASES) {
      for (const update of parseBranch(testCase.branch).updates) {
        expect(update.source).toBe('branch');
      }
    }
  });

  it('finds nothing in a branch that is not a bot branch', () => {
    expect(parseBranch('feature/rewrite-everything').updates).toEqual([]);
  });
});
