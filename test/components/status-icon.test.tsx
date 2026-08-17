import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusIcon } from '../../src/components/status-icon';
import type { CheckState } from '../../src/lib/types';

afterEach(cleanup);

describe('StatusIcon', () => {
  it.each<[CheckState, string]>([
    [ 'success', 'Passing' ],
    [ 'failure', 'Failing' ],
    [ 'pending', 'Running' ],
    [ 'error', 'Errored' ],
    [ 'none', 'No checks' ],
  ])('labels %s so the colour is not the only signal', (state, label) => {
    render(<StatusIcon state={state} />);
    const icon = screen.getByRole('img', { name: label });
    expect(icon.classList.contains(`status-icon--${state}`)).toBe(true);
  });

  it('renders at the default size, and at whatever size it is given', () => {
    const { container } = render(<StatusIcon state="success" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('14');
    cleanup();
    const smaller = render(<StatusIcon state="success" size={12} />);
    expect(smaller.container.querySelector('svg')?.getAttribute('width')).toBe('12');
  });
});
