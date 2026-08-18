import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, formatGroupAsText } from '../src/lib/clipboard';
import type { IGroup } from '../src/lib/selectors';
import { countByState, worstState } from '../src/lib/selectors';
import type { IRenovatePr } from '../src/lib/types';
import { pr } from './fixtures';

function group(prs: IRenovatePr[], label = 'typescript'): IGroup {
  return { key: label, label, prs, counts: countByState(prs), worst: worstState(prs) };
}

describe('formatGroupAsText', () => {
  it('names the group and bullets its repositories', () => {
    const text = formatGroupAsText(group([
      pr({ id: '1', repo: 'rubensworks/rdf-parse.js' }),
      pr({ id: '2', repo: 'rubensworks/rdf-serialize.js' }),
    ]));
    expect(text).toBe('typescript:\n\n* rubensworks/rdf-parse.js\n* rubensworks/rdf-serialize.js\n');
  });

  it('lists a repository once however many pull requests it has in the group', () => {
    const text = formatGroupAsText(group([
      pr({ id: '1', repo: 'rubensworks/rdf-parse.js' }),
      pr({ id: '2', repo: 'rubensworks/rdf-parse.js' }),
      pr({ id: '3', repo: 'rubensworks/jbr.js' }),
    ]));
    expect(text).toBe('typescript:\n\n* rubensworks/rdf-parse.js\n* rubensworks/jbr.js\n');
  });

  it('keeps the order the group is displayed in, so the text matches the screen', () => {
    const text = formatGroupAsText(group([
      pr({ id: '1', repo: 'zeta/last' }),
      pr({ id: '2', repo: 'alpha/first' }),
    ]));
    expect(text).toBe('typescript:\n\n* zeta/last\n* alpha/first\n');
  });

  it('handles a group whose label carries a space, like an unrecognised one', () => {
    const text = formatGroupAsText(group([ pr({ repo: 'rubensworks/jbr.js' }) ], 'Unrecognised'));
    expect(text).toBe('Unrecognised:\n\n* rubensworks/jbr.js\n');
  });

  it('produces just the name when the group somehow has nothing in it', () => {
    expect(formatGroupAsText(group([]))).toBe('typescript:\n\n\n');
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
