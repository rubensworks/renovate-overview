import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrActions } from '../../src/components/pr-actions';
import type { IRenovatePr, ISettings } from '../../src/lib/types';
import { SETTINGS, pr } from '../fixtures';

afterEach(cleanup);

const WRITABLE: ISettings = { ...SETTINGS, writeActions: true };

function renderActions(target: IRenovatePr = pr(), settings = WRITABLE) {
  const onAction = vi.fn();
  render(<PrActions pr={target} settings={settings} onAction={onAction} />);
  return onAction;
}

describe('PrActions', () => {
  it('offers nothing at all while the app is read-only', () => {
    renderActions(pr(), SETTINGS);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Read-only/u)).toBeDefined();
  });

  it('offers the actions that could actually succeed', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ask Renovate to rebase' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
    // Nothing failed, so there is nothing to re-run.
    expect(screen.queryByRole('button', { name: 'Re-run failed jobs' })).toBeNull();
  });

  it('hides merging on a conflicting pull request rather than offering a certain failure', () => {
    renderActions(pr({ mergeable: 'CONFLICTING' }));
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask Renovate to rebase' })).toBeDefined();
  });

  it('offers a re-run when a failed check points at a workflow run', () => {
    renderActions(pr({ checks: [
      { name: 'build', state: 'failure', url: 'https://github.com/o/r/actions/runs/1' },
    ]}));
    expect(screen.getByRole('button', { name: 'Re-run failed jobs' })).toBeDefined();
  });

  it('says which merge method it would use', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'Merge' }).getAttribute('title'))
      .toBe('Using Squash and merge');
  });

  it('asks for the action rather than performing it', () => {
    const onAction = renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onAction).toHaveBeenCalledWith('approve', expect.objectContaining({ id: 'PR_1' }));
  });

  it('marks closing as the destructive one', () => {
    const { container } = render(<PrActions pr={pr()} settings={WRITABLE} onAction={() => {}} />);
    expect(container.querySelector('.button--danger')?.textContent).toBe('Close');
  });
});
