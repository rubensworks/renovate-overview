import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/components/dashboard';
import type { DashboardStore } from '../../src/lib/store';
import { INITIAL_STATE } from '../../src/lib/store';
import type { IDashboardState } from '../../src/lib/types';
import { pr } from '../fixtures';

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
  public readonly loadBodies = vi.fn(async() => {});
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
  render(<Dashboard store={store as unknown as DashboardStore} />);
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

  describe('bodies', () => {
    it('fetches them when grouping by dependency, where a group needs its members', () => {
      const store = renderDashboard({ prs: [ GREEN, RED ]}, '#g=dependency');
      expect(store.loadBodies).toHaveBeenCalledWith([ 'g', 'r' ]);
    });

    it('leaves them alone in a flat list', () => {
      const store = renderDashboard({ prs: [ GREEN ]});
      expect(store.loadBodies).not.toHaveBeenCalled();
    });

    it('asks for one when its row is expanded', () => {
      const store = renderDashboard({ prs: [ GREEN ]});
      fireEvent.click(screen.getByRole('button', { name: /Expand/u }));
      expect(store.loadBodies).toHaveBeenCalledWith([ 'g' ]);
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
