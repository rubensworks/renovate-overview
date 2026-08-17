import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../src/lib/renovate/parseTitle';
import { TITLE_CASES } from './titles';

describe('parseTitle', () => {
  describe.each(TITLE_CASES)('$title', (testCase) => {
    const parsed = parseTitle(testCase.title);

    it('never throws, and always resolves to something', () => {
      expect(parsed).toBeDefined();
      expect(Array.isArray(parsed.updates)).toBe(true);
    });

    if (testCase.deps !== undefined) {
      it('names the dependencies it can', () => {
        expect(parsed.updates.map(update => update.depName)).toEqual(testCase.deps);
      });
    }

    if (testCase.newVersion !== undefined) {
      it('reads the new version', () => {
        expect(parsed.updates[0]?.newVersion ?? parsed.newVersion).toBe(testCase.newVersion);
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

    if (testCase.groupName !== undefined) {
      it('names the group', () => {
        expect(parsed.groupName).toBe(testCase.groupName);
      });
    }

    if (testCase.manager !== undefined) {
      it('hints at the manager', () => {
        expect(parsed.updates[0]?.manager).toBe(testCase.manager);
      });
    }

    if (testCase.groupKey !== undefined) {
      it('normalises the grouping key', () => {
        expect(parsed.updates[0]?.groupKey).toBe(testCase.groupKey);
      });
    }
  });

  it('marks everything it produces as coming from the title', () => {
    for (const testCase of TITLE_CASES) {
      for (const update of parseTitle(testCase.title).updates) {
        expect(update.source).toBe('title');
      }
    }
  });

  it('does not mistake a base branch suffix for an update type', () => {
    expect(parseTitle('Update dependency foo to v2 (master)').updates[0]?.updateType).toBe('unknown');
    expect(parseTitle('Update dependency foo to v2 (major)').updates[0]?.updateType).toBe('major');
  });

  it('treats a title it cannot read as unrecognised rather than guessing', () => {
    const parsed = parseTitle('Merge branch master into develop');
    expect(parsed.updates).toEqual([]);
    expect(parsed.isGroupPr).toBe(false);
  });
});
