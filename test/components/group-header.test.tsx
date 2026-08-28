import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_FEEDBACK_MS, GroupHeader } from '../../src/components/group-header';
import type { IGroup } from '../../src/lib/selectors';
import { countByState, worstState } from '../../src/lib/selectors';
import type { IRenovatePr } from '../../src/lib/types';
import { pr } from '../fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function group(prs: IRenovatePr[], label = 'lodash'): IGroup {
  return { key: label, label, prs, counts: countByState(prs), worst: worstState(prs) };
}

describe('GroupHeader', () => {
  it('names the group and counts its pull requests', () => {
    render(<GroupHeader mode="dependency" group={group([ pr() ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('lodash')).toBeDefined();
    expect(screen.getByText('1 PR')).toBeDefined();
  });

  it('pluralises the count', () => {
    render(<GroupHeader mode="dependency" group={group([ pr(), pr({ id: 'b' }) ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('2 PRs')).toBeDefined();
  });

  it('breaks the group down by state, which is the whole point of the header', () => {
    const prs = [
      pr({ id: '1' }),
      pr({ id: '2', checkState: 'failure' }),
      pr({ id: '3', checkState: 'error' }),
      pr({ id: '4', checkState: 'pending' }),
      pr({ id: '5', checkState: 'none' }),
    ];
    render(<GroupHeader mode="dependency" group={group(prs)} collapsed={false} onToggle={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('1 green')).toBeDefined();
    // An errored check counts with the failures, not on its own.
    expect(screen.getByText('2 red')).toBeDefined();
    expect(screen.getByText('1 running')).toBeDefined();
    expect(screen.getByText('1 unchecked')).toBeDefined();
  });

  it('leaves out the tallies that are zero', () => {
    const { container } = render(
      <GroupHeader mode="dependency" group={group([ pr() ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />,
    );
    expect(container.querySelectorAll('.tally')).toHaveLength(1);
  });

  it('is coloured by the worst state in it', () => {
    const { container } = render(
      <GroupHeader mode="dependency" group={group([ pr(), pr({ id: 'b', checkState: 'failure' }) ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />,
    );
    expect(container.querySelector('.group__header--failure')).not.toBeNull();
  });

  it('offers to select the ones that are ready to merge, and says how many', () => {
    const selected: string[][] = [];
    render(
      <GroupHeader
        mode="dependency"
        group={group([ pr(), pr({ id: 'b', isDraft: true }) ])}
        collapsed={false}
        onToggle={() => {}}
        onSelect={ids => selected.push(ids)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select 1 ready to merge' }));
    // The draft is not ready, so it is left out.
    expect(selected).toEqual([[ 'rubensworks/jbr.js#42' ]]);
  });

  it('offers to select everything in the group', () => {
    const selected: string[][] = [];
    render(
      <GroupHeader
        mode="dependency"
        group={group([ pr(), pr({ id: 'b', isDraft: true }) ])}
        collapsed={false}
        onToggle={() => {}}
        onSelect={ids => selected.push(ids)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(selected).toEqual([[ 'rubensworks/jbr.js#42', 'b' ]]);
  });

  it('offers to exclude a repository, but only where a group is one repository', () => {
    const excluded: string[] = [];
    const { rerender } = render(
      <GroupHeader
        mode="repo"
        group={group([ pr() ], 'rubensworks/jbr.js')}
        collapsed={false}
        onToggle={() => {}}
        onSelect={() => {}}
        onExclude={repo => excluded.push(repo)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Exclude' }));
    expect(excluded).toEqual([ 'rubensworks/jbr.js' ]);

    rerender(
      <GroupHeader mode="dependency" group={group([ pr() ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Exclude' })).toBeNull();
  });

  it('says nothing about merging when nothing is ready', () => {
    render(<GroupHeader mode="dependency" group={group([ pr({ checkState: 'failure' }) ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />);
    expect(screen.queryByText(/ready to merge/u)).toBeNull();
  });

  it('copies the group as plain text', async() => {
    const writeText = vi.fn(async(): Promise<void> => {});
    vi.stubGlobal('navigator', { clipboard: { writeText }});
    render(
      <GroupHeader
        mode="dependency"
        group={group([ pr({ id: '1', repo: 'rubensworks/rdf-parse.js' }), pr({ id: '2', repo: 'rubensworks/jbr.js' }) ], 'typescript')}
        collapsed={false}
        onToggle={() => {}}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('typescript:\n\n* rubensworks/rdf-parse.js\n* rubensworks/jbr.js\n');
  });

  it('copies what a group is keyed on differently, so a repository group lists its pull requests', async() => {
    const writeText = vi.fn(async(): Promise<void> => {});
    vi.stubGlobal('navigator', { clipboard: { writeText }});
    const repo = 'CyclopsMC/forge-update-generator.js';
    render(
      <GroupHeader
        mode="repo"
        group={group([
          pr({ id: '1', repo, title: 'Update dependency typescript to v5' }),
          pr({ id: '2', repo, title: 'Update dependency eslint to v9' }),
        ], repo)}
        collapsed={false}
        onToggle={() => {}}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(`${repo}:\n\n* typescript\n* eslint\n`);
  });

  it('says it copied, then goes back to offering the copy', async() => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async(): Promise<void> => {}) }});
    render(<GroupHeader mode="dependency" group={group([ pr() ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    // The write settles on the microtask queue, which the fake timers do not drive.
    await act(async() => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined();

    await act(async() => {
      vi.advanceTimersByTime(COPIED_FEEDBACK_MS);
    });
    expect(screen.getByRole('button', { name: 'Copy as text' })).toBeDefined();
  });

  it('says so when the clipboard refuses, rather than looking like nothing happened', async() => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }});
    render(<GroupHeader mode="dependency" group={group([ pr() ])} collapsed={false} onToggle={() => {}} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy failed' })).toBeDefined());
  });

  it('reports whether it is collapsed, and asks to be toggled', () => {
    const onToggle = vi.fn();
    render(<GroupHeader mode="dependency" group={group([ pr() ])} collapsed onToggle={onToggle} onSelect={() => {}} />);
    const toggle = screen.getByRole('button', { name: '▸' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('lodash');
  });
});
