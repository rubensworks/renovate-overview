import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionProgress } from '../../src/components/action-progress';
import type { IActionResult, IActionRun } from '../../src/lib/types';

afterEach(cleanup);

function result(overrides: Partial<IActionResult> = {}): IActionResult {
  return { prId: 'a', label: 'o/r#1', outcome: 'succeeded', message: undefined, ...overrides };
}

function run(overrides: Partial<IActionRun> = {}): IActionRun {
  return { kind: 'merge', results: [ result() ], running: false, stoppedReason: undefined, ...overrides };
}

describe('ActionProgress', () => {
  it('names the action and counts how far it has got', () => {
    render(
      <ActionProgress
        run={run({ results: [ result(), result({ prId: 'b', outcome: 'pending' }) ], running: true })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Merge')).toBeDefined();
    expect(screen.getByText('1 of 2')).toBeDefined();
    expect(screen.getByText('working…')).toBeDefined();
  });

  it('counts the failures apart, since a half-worked bulk action is the normal case', () => {
    render(
      <ActionProgress
        run={run({ results: [ result(), result({ prId: 'b', outcome: 'failed', message: 'nope' }) ]})}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('2 of 2, 1 failed')).toBeDefined();
    expect(screen.getByText('nope')).toBeDefined();
  });

  it('lists every pull request it attempted, with its outcome', () => {
    const { container } = render(
      <ActionProgress
        run={run({ results: [
          result({ prId: '1', outcome: 'succeeded' }),
          result({ prId: '2', outcome: 'failed' }),
          result({ prId: '3', outcome: 'skipped' }),
          result({ prId: '4', outcome: 'running' }),
          result({ prId: '5', outcome: 'pending' }),
        ]})}
        onDismiss={() => {}}
      />,
    );
    expect(container.querySelectorAll('.progress__item')).toHaveLength(5);
    expect(container.querySelector('.progress__item--failed')).not.toBeNull();
  });

  it('says when the queue gave up early', () => {
    render(<ActionProgress run={run({ stoppedReason: 'Stopped after 3 failures' })} onDismiss={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Stopped after 3 failures');
  });

  it('can only be dismissed once it has finished', () => {
    const onDismiss = vi.fn();
    render(<ActionProgress run={run({ running: true })} onDismiss={onDismiss} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    cleanup();
    render(<ActionProgress run={run()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
