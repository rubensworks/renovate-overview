import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, formatGroupAsText } from '../src/lib/clipboard';
import type { IGroup } from '../src/lib/selectors';
import { countByState, worstState } from '../src/lib/selectors';
import type { IRenovatePr } from '../src/lib/types';
import { pr } from './fixtures';

function group(prs: IRenovatePr[], label = 'typescript'): IGroup {
  return { key: label, label, prs, counts: countByState(prs), worst: worstState(prs) };
}

function updating(repo: string, dep: string, number: number): IRenovatePr {
  return pr({
    id: `${repo}#${number}`,
    repo,
    owner: repo.split('/')[0],
    number,
    title: `Update dependency ${dep} to v2.0.0`,
    branch: `renovate/${dep}-2.x`,
  });
}

describe('formatGroupAsText', () => {
  describe('grouped by dependency', () => {
    it('names the group and lists the repositories waiting on it', () => {
      const text = formatGroupAsText(group([
        updating('rubensworks/rdf-parse.js', 'typescript', 1),
        updating('rubensworks/rdf-serialize.js', 'typescript', 2),
      ]), 'dependency');
      expect(text).toBe('typescript:\n\n* rubensworks/rdf-parse.js\n* rubensworks/rdf-serialize.js\n');
    });

    it('keeps the order the group is displayed in, so the text matches the screen', () => {
      const text = formatGroupAsText(group([
        updating('zeta/last', 'typescript', 1),
        updating('alpha/first', 'typescript', 2),
      ]), 'dependency');
      expect(text).toBe('typescript:\n\n* zeta/last\n* alpha/first\n');
    });
  });

  describe('grouped by repository', () => {
    it('lists every pull request, not the one repository they all share', () => {
      // The bug this replaced: six pull requests on one repository copied as a single line.
      const repo = 'CyclopsMC/forge-update-generator.js';
      const text = formatGroupAsText(group([
        updating(repo, 'typescript', 1),
        updating(repo, 'eslint', 2),
        updating(repo, 'jest', 3),
      ], repo), 'repo');
      expect(text).toBe(`${repo}:\n\n* typescript\n* eslint\n* jest\n`);
    });

    it('names a group pull request by the group Renovate gave it', () => {
      const grouped = pr({
        repo: 'rubensworks/jbr.js',
        parse: {
          updates: [
            { depName: 'typescript', groupKey: 'typescript', updateType: 'minor', source: 'body' },
            { depName: 'eslint', groupKey: 'eslint', updateType: 'minor', source: 'body' },
          ],
          isGroupPr: true,
          groupName: 'all non-major dependencies',
          updateType: 'minor',
          source: 'body',
          disagreements: [],
        },
      });
      expect(formatGroupAsText(group([ grouped ], 'rubensworks/jbr.js'), 'repo'))
        .toBe('rubensworks/jbr.js:\n\n* all non-major dependencies\n');
    });

    it('lists the packages of a group pull request that named no group', () => {
      const grouped = pr({
        parse: {
          updates: [
            { depName: 'typescript', groupKey: 'typescript', updateType: 'minor', source: 'body' },
            { depName: 'eslint', groupKey: 'eslint', updateType: 'minor', source: 'body' },
          ],
          isGroupPr: true,
          groupName: undefined,
          updateType: 'minor',
          source: 'body',
          disagreements: [],
        },
      });
      expect(formatGroupAsText(group([ grouped ], 'rubensworks/jbr.js'), 'repo'))
        .toBe('rubensworks/jbr.js:\n\n* typescript, eslint\n');
    });

    it('falls back to the title for a pull request nothing could be parsed out of', () => {
      const unknown = pr({
        title: 'Pin dependencies',
        parse: {
          updates: [],
          isGroupPr: false,
          groupName: undefined,
          updateType: 'unknown',
          source: 'unknown',
          disagreements: [],
        },
      });
      expect(formatGroupAsText(group([ unknown ], 'rubensworks/jbr.js'), 'repo'))
        .toBe('rubensworks/jbr.js:\n\n* Pin dependencies\n');
    });
  });

  describe('grouped by something broader', () => {
    it('carries both the repository and the dependency, since both vary', () => {
      const text = formatGroupAsText(group([
        updating('rubensworks/rdf-parse.js', 'typescript', 1),
        updating('rubensworks/jbr.js', 'eslint', 2),
      ], 'rubensworks'), 'owner');
      expect(text).toBe(
        'rubensworks:\n\n* rubensworks/rdf-parse.js — typescript\n* rubensworks/jbr.js — eslint\n',
      );
    });

    it('does the same for an update-type group', () => {
      const minor = group([ updating('rubensworks/jbr.js', 'typescript', 1) ], 'minor');
      const text = formatGroupAsText(minor, 'update-type');
      expect(text).toBe('minor:\n\n* rubensworks/jbr.js — typescript\n');
    });
  });

  it('gives every pull request a line, even two that read the same', () => {
    // Two pull requests on one repository can both belong to a dependency group. A repeated line
    // is better than a list that silently accounts for fewer pull requests than the header says.
    const text = formatGroupAsText(group([
      updating('rubensworks/jbr.js', 'typescript', 1),
      updating('rubensworks/jbr.js', 'typescript', 2),
    ]), 'dependency');
    expect(text).toBe('typescript:\n\n* rubensworks/jbr.js\n* rubensworks/jbr.js\n');
  });

  it('produces just the name when the group somehow has nothing in it', () => {
    expect(formatGroupAsText(group([]), 'dependency')).toBe('typescript:\n\n\n');
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports success when the clipboard takes it', async() => {
    const writeText = vi.fn(async(): Promise<void> => {});
    vi.stubGlobal('navigator', { clipboard: { writeText }});
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('reports failure rather than throwing when the clipboard refuses', async() => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }});
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('reports failure rather than throwing when there is no clipboard at all', async() => {
    // Which is what a page served over plain HTTP gets.
    vi.stubGlobal('navigator', {});
    await expect(copyText('hello')).resolves.toBe(false);
  });
});
