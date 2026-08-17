import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/components/dashboard';
import type { DashboardStore } from '../../src/lib/store';
import { INITIAL_STATE } from '../../src/lib/store';
import type { IDashboardState } from '../../src/lib/types';
import { SETTINGS, pr } from '../fixtures';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

/**
 * A store stand-in whose snapshot the test drives directly.
 */
class FakeStore {
  public readonly refresh = vi.fn(async() => {});
  public readonly loadReviewDecision = vi.fn(async() => {});
  public readonly runActions = vi.fn(async() => {});
  public readonly clearActionRun = vi.fn();
  public readonly setSelection = vi.fn((ids: string[]) => this.set({ selected: [ ...new Set(ids) ]}));
  public readonly toggleSelection = vi.fn((id: string) => this.set({
    selected: this.getSnapshot().selected.includes(id) ?
      this.getSnapshot().selected.filter(entry => entry !== id) :
        [ ...this.getSnapshot().selected, id ],
  }));

  private readonly listeners = new Set<() => void>();
  private state: IDashboardState;

  public constructor(state: Partial<IDashboardState> = {}) {
    this.state = { ...INITIAL_STATE, ...state };
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): IDashboardState => this.state;

  public set(next: Partial<IDashboardState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function renderDashboard(state: Partial<IDashboardState> = {}, hash = ''): FakeStore {
  history.replaceState(null, '', `/${hash}`);
  const store = new FakeStore(state);
  render(<Dashboard store={store as unknown as DashboardStore} settings={SETTINGS} />);
  return store;
}

const GREEN = pr({ id: 'g', title: 'Update dependency lodash to v4.17.21', branch: 'renovate/lodash-4.x' });
const RED = pr({
  id: 'r',
  repo: 'comunica/comunica',
  owner: 'comunica',
  number: 7,
  title: 'Update dependency @types/node to v20.11.5',
  branch: 'renovate/types-node-20.x',
  checkState: 'failure',
});

describe('Dashboard', () => {
  it('says so when there is nothing to show', () => {
    renderDashboard();
    expect(screen.getByText(/No open Renovate pull requests/u)).toBeDefined();
  });

  it('points at the error instead when one is set', () => {
    renderDashboard({ error: 'offline' });
    expect(screen.getByText('Nothing loaded — see the error below.')).toBeDefined();
  });

  it('lists a row per pull request', () => {
    renderDashboard({ prs: [ pr(), pr({ id: 'PR_2', number: 43 }) ]});
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('refreshes on demand', () => {
    const store = renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it('disables the refresh button while a refresh is running', () => {
    renderDashboard({ loading: true });
    const button = screen.getByRole('button', { name: 'Refreshing…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows how far through a long load it is', () => {
    renderDashboard({ loading: true, prs: [ pr() ], totalCount: 120 });
    expect(screen.getByText('1 of 120')).toBeDefined();
  });

  it('says nothing about progress once everything has arrived', () => {
    renderDashboard({ loading: false, prs: [ pr() ], totalCount: 120 });
    expect(screen.queryByText('1 of 120')).toBeNull();
  });

  it('re-renders when the store changes underneath it', () => {
    const store = renderDashboard();
    act(() => store.set({ prs: [ pr() ]}));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  describe('the view', () => {
    it('starts from the URL fragment', () => {
      renderDashboard({ prs: [ GREEN, RED ]}, '#g=repo&failing=1');
      expect(screen.getAllByText('comunica/comunica').length).toBeGreaterThan(0);
      expect(screen.queryByText('rubensworks/jbr.js')).toBeNull();
    });

    it('writes itself back into the fragment, so a view is a link', () => {
      renderDashboard({ prs: [ GREEN ]});
      fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'dependency' }});
      expect(location.hash).toBe('#g=dependency');
    });

    it('groups, with a header per group', () => {
      renderDashboard({ prs: [ GREEN, RED ]}, '#g=dependency');
      const labels = [ ...document.querySelectorAll('.group__label') ].map(label => label.textContent);
      expect(labels).toEqual([ '@types/node', 'lodash' ]);
    });

    it('collapses a group, and remembers that in the fragment', () => {
      renderDashboard({ prs: [ GREEN ]}, '#g=dependency');
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      fireEvent.click(screen.getAllByRole('button', { name: '▾' })[0] as HTMLElement);
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      expect(location.hash).toContain('c=lodash');
    });

    it('expands a collapsed group again', () => {
      renderDashboard({ prs: [ GREEN ]}, '#g=dependency&c=lodash');
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      fireEvent.click(screen.getAllByRole('button', { name: '▸' })[0] as HTMLElement);
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(location.hash).not.toContain('c=');
    });

    it('labels a group pull request by the group it is under, not by its first package', () => {
      const groupPr = pr({
        id: 'multi',
        title: 'Update all non-major dependencies',
        branch: 'renovate/all-minor-patch',
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
        bodyLoaded: true,
      });
      renderDashboard({ prs: [ groupPr ]}, '#g=dependency&gs=name');
      const rows = [ ...document.querySelectorAll('.pr__dep') ].map(entry => entry.textContent);
      expect(rows).toEqual([ '@types/node', 'lodash' ]);
    });

    it('says when the filters, rather than the data, are why the list is empty', () => {
      renderDashboard({ prs: [ GREEN ]}, '#q=nothingmatchesthis');
      expect(screen.getByText('No pull request matches these filters.')).toBeDefined();
    });
  });

  describe('review decisions', () => {
    it('asks for one when a row is expanded, since REST charges a request for it', () => {
      const store = renderDashboard({ prs: [ GREEN ]});
      fireEvent.click(screen.getByRole('button', { name: /Expand/u }));
      expect(store.loadReviewDecision).toHaveBeenCalledWith('g');
    });

    it('asks for nothing while the rows are merely listed', () => {
      const store = renderDashboard({ prs: [ GREEN, RED ]}, '#g=dependency');
      expect(store.loadReviewDecision).not.toHaveBeenCalled();
    });
  });

  describe('actions', () => {
    const WRITABLE = { ...SETTINGS, writeActions: true };

    function renderWritable(state: Partial<IDashboardState> = {}, hash = ''): FakeStore {
      history.replaceState(null, '', `/${hash}`);
      const store = new FakeStore(state);
      render(<Dashboard store={store as unknown as DashboardStore} settings={WRITABLE} />);
      return store;
    }

    it('selects a row, and shows the bulk bar once something is selected', () => {
      const store = renderWritable({ prs: [ GREEN ]});
      expect(screen.queryByText('1 selected')).toBeNull();
      fireEvent.click(screen.getByLabelText('Select rubensworks/jbr.js #42'));
      expect(store.toggleSelection).toHaveBeenCalledWith('g');
      expect(screen.getByText('1 selected')).toBeDefined();
    });

    it('selects everything ready to merge in a group, from its header', () => {
      const store = renderWritable({ prs: [ GREEN, RED ]}, '#g=repo');
      fireEvent.click(screen.getAllByRole('button', { name: /Select 1 ready to merge/u })[0] as HTMLElement);
      expect(store.setSelection).toHaveBeenCalledWith([ 'g' ]);
    });

    it('confirms before writing anything, naming the action and the count', () => {
      const store = renderWritable({ prs: [ GREEN, RED ], selected: [ 'g', 'r' ]});
      fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));

      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('Merge on 2 pull requests');
      expect(dialog.textContent).toContain('rubensworks/jbr.js#42');
      expect(store.runActions).not.toHaveBeenCalled();
    });

    it('runs the action once confirmed', () => {
      const store = renderWritable({ prs: [ GREEN ], selected: [ 'g' ]});
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      expect(store.runActions).toHaveBeenCalledWith('approve', [ GREEN ]);
    });

    it('does nothing when the confirmation is cancelled', () => {
      const store = renderWritable({ prs: [ GREEN ], selected: [ 'g' ]});
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(store.runActions).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('warns about what closing means to Renovate', () => {
      renderWritable({ prs: [ GREEN ]});
      fireEvent.click(screen.getByRole('button', { name: /Expand/u }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.getByRole('dialog').textContent).toContain('never offer this update again');
    });

    it('says a bulk merge is sequential and stops early', () => {
      renderWritable({ prs: [ GREEN, RED ], selected: [ 'g', 'r' ]});
      fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));
      expect(screen.getByRole('dialog').textContent).toContain('one at a time');
    });

    it('summarises a long list rather than printing a wall of names', () => {
      const many = Array.from({ length: 8 }, (_unused, index) =>
        pr({ id: `p${index}`, number: index, repo: `o/r${index}` }));
      renderWritable({ prs: many, selected: many.map(entry => entry.id) });
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));
      expect(screen.getByRole('dialog').textContent).toContain('and 3 more');
    });

    it('runs a per-pull-request action from the expanded row', () => {
      const store = renderWritable({ prs: [ GREEN ]});
      fireEvent.click(screen.getByRole('button', { name: /Expand/u }));
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[1] as HTMLElement);
      expect(store.runActions).toHaveBeenCalledWith('approve', [ GREEN ]);
    });

    it('shows the progress list while a run is going, and dismisses it after', () => {
      const store = renderWritable({
        prs: [ GREEN ],
        actionRun: {
          kind: 'merge',
          results: [{ prId: 'g', label: 'o/r#1', outcome: 'succeeded', message: undefined }],
          running: false,
          stoppedReason: undefined,
        },
      });
      expect(screen.getByText('o/r#1')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(store.clearActionRun).toHaveBeenCalledTimes(1);
    });

    it('clears the selection', () => {
      const store = renderWritable({ prs: [ GREEN ], selected: [ 'g' ]});
      fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
      expect(store.setSelection).toHaveBeenCalledWith([]);
    });
  });

  describe('the tab itself', () => {
    it('reflects the worst state in the title and the favicon', () => {
      renderDashboard({ prs: [ GREEN, RED ]});
      expect(document.title).toBe('(1✕) Renovate Overview');
      expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain('data:image/svg+xml');
    });

    it('counts what is open when nothing is failing', () => {
      renderDashboard({ prs: [ GREEN ]});
      expect(document.title).toBe('(1) Renovate Overview');
    });
  });

  describe('keyboard shortcuts', () => {
    it('puts the cursor in the filter on /', () => {
      renderDashboard({ prs: [ GREEN ]});
      fireEvent.keyDown(document, { key: '/' });
      expect(document.activeElement).toBe(screen.getByLabelText('Filter'));
    });

    it('refreshes on r', () => {
      const store = renderDashboard({ prs: [ GREEN ]});
      fireEvent.keyDown(document, { key: 'r' });
      expect(store.refresh).toHaveBeenCalledTimes(1);
    });

    it('toggles grouping by dependency on g', () => {
      renderDashboard({ prs: [ GREEN ]});
      fireEvent.keyDown(document, { key: 'g' });
      expect(location.hash).toBe('#g=dependency');
      fireEvent.keyDown(document, { key: 'g' });
      expect(location.hash).toBe('');
    });

    it.each([ 'Filter', 'Group' ])('stays out of the way while %s is being used', (label) => {
      const store = renderDashboard({ prs: [ GREEN ]});
      fireEvent.keyDown(screen.getByLabelText(label), { key: 'r' });
      expect(store.refresh).not.toHaveBeenCalled();
    });

    it('ignores a shortcut that is part of a browser chord', () => {
      const store = renderDashboard({ prs: [ GREEN ]});
      fireEvent.keyDown(document, { key: 'r', metaKey: true });
      fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
      fireEvent.keyDown(document, { key: 'r', altKey: true });
      expect(store.refresh).not.toHaveBeenCalled();
    });

    it('does nothing for a key it has no use for', () => {
      const store = renderDashboard({ prs: [ GREEN ]});
      fireEvent.keyDown(document, { key: 'q' });
      expect(store.refresh).not.toHaveBeenCalled();
      expect(location.hash).toBe('');
    });

    it('closes a confirmation on Escape, from anywhere including a field', () => {
      const store = new FakeStore({ prs: [ GREEN ], selected: [ 'g' ]});
      render(<Dashboard store={store as unknown as DashboardStore} settings={{ ...SETTINGS, writeActions: true }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }));
      expect(screen.getByRole('dialog')).toBeDefined();
      fireEvent.keyDown(screen.getByLabelText('Filter'), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('keeps the relative ages moving without a refresh', () => {
    renderDashboard({ prs: [ pr({ updatedAt: new Date(Date.now() - 1000).toISOString() }) ]});
    expect(screen.getByText('1s')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('1m')).toBeDefined();
  });
});
