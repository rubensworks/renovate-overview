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
});

/**
 * A store stand-in whose snapshot the test drives directly.
 */
class FakeStore {
  public readonly refresh = vi.fn(async() => {});
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

function renderDashboard(state: Partial<IDashboardState> = {}): FakeStore {
  const store = new FakeStore(state);
  render(<Dashboard store={store as unknown as DashboardStore} />);
  return store;
}

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

  it('keeps the relative ages moving without a refresh', () => {
    renderDashboard({ prs: [ pr({ updatedAt: new Date(Date.now() - 1000).toISOString() }) ]});
    expect(screen.getByText('1s')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('1m')).toBeDefined();
  });
});
