import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../src/components/confirm-dialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('names what is about to happen', () => {
    render(
      <ConfirmDialog
        title="Merge?"
        detail={<p>Merge on 3 pull requests.</p>}
        confirmLabel="Merge"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Merge?' })).toBeDefined();
    expect(screen.getByText('Merge on 3 pull requests.')).toBeDefined();
  });

  it('confirms and cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Close?" detail="gone" confirmLabel="Close" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels when the backdrop is clicked, but not the box itself', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog title="Close?" detail="gone" confirmLabel="Close" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.modal') as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('styles a destructive confirmation as one', () => {
    const { container } = render(
      <ConfirmDialog title="Close?" detail="gone" confirmLabel="Close" danger onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector('.button--danger')).not.toBeNull();
    cleanup();
    const safe = render(
      <ConfirmDialog title="Merge?" detail="ok" confirmLabel="Merge" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(safe.container.querySelector('.button--primary')).not.toBeNull();
  });
});
