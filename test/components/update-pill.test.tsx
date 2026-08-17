import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UpdatePill } from '../../src/components/update-pill';
import type { UpdateType } from '../../src/lib/types';

afterEach(cleanup);

describe('UpdatePill', () => {
  it.each<[UpdateType, string]>([
    [ 'major', 'major' ],
    [ 'minor', 'minor' ],
    [ 'patch', 'patch' ],
    [ 'digest', 'digest' ],
    [ 'pin', 'pin' ],
    [ 'rollback', 'rollback' ],
    [ 'replacement', 'replace' ],
    [ 'lockFileMaintenance', 'lockfile' ],
  ])('shows %s', (updateType, label) => {
    const { container } = render(<UpdatePill updateType={updateType} />);
    expect(screen.getByText(label)).toBeDefined();
    expect(container.querySelector(`.pill--${updateType}`)).not.toBeNull();
  });

  it('shows nothing at all when the type could not be worked out', () => {
    const { container } = render(<UpdatePill updateType="unknown" />);
    expect(container.innerHTML).toBe('');
  });
});
