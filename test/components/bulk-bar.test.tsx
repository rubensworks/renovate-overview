import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IBulkBarProps } from '../../src/components/bulk-bar';
import { BulkBar } from '../../src/components/bulk-bar';
import { SETTINGS } from '../fixtures';

afterEach(cleanup);

function renderBar(overrides: Partial<IBulkBarProps> = {}) {
  const onAction = vi.fn();
  const onClear = vi.fn();
  render(
    <BulkBar
      selectedCount={2}
      droppedCount={0}
      settings={{ ...SETTINGS, writeActions: true }}
      onAction={onAction}
      onClear={onClear}
      {...overrides}
    />,
  );
  return { onAction, onClear };
}

describe('BulkBar', () => {
  it('stays out of the way while nothing is selected', () => {
    const { container } = render(
      <BulkBar selectedCount={0} droppedCount={0} settings={SETTINGS} onAction={() => {}} onClear={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('counts the selection, in the singular and the plural', () => {
    renderBar({ selectedCount: 1 });
    expect(screen.getByText('1 selected')).toBeDefined();
    cleanup();
    renderBar({ selectedCount: 4 });
    expect(screen.getByText('4 selected')).toBeDefined();
  });

  it('offers the bulk actions, but not closing', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Merge selected' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Enable auto-merge selected' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve selected' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ask Renovate to rebase selected' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Close/u })).toBeNull();
  });

  it('asks for an action', () => {
    const { onAction } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));
    expect(onAction).toHaveBeenCalledWith('merge');
  });

  it('offers nothing to do while the app is read-only', () => {
    renderBar({ settings: SETTINGS });
    expect(screen.queryByRole('button', { name: 'Merge selected' })).toBeNull();
    expect(screen.getByText(/Read-only/u)).toBeDefined();
  });

  it('says when a selected pull request has since gone', () => {
    renderBar({ droppedCount: 1 });
    expect(screen.getByRole('status').textContent).toBe('1 selected pull request has since gone');
    cleanup();
    renderBar({ droppedCount: 3 });
    expect(screen.getByRole('status').textContent).toBe('3 selected pull requests have since gone');
  });

  it('still appears to report a drop when the selection itself is now empty', () => {
    renderBar({ selectedCount: 0, droppedCount: 2 });
    expect(screen.getByRole('status')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Merge selected' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears the selection', () => {
    const { onClear } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
