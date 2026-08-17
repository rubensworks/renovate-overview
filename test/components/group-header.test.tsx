import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupHeader } from '../../src/components/group-header';
import type { IGroup } from '../../src/lib/selectors';
import { countByState, worstState } from '../../src/lib/selectors';
import type { IRenovatePr } from '../../src/lib/types';
import { pr } from '../fixtures';

afterEach(cleanup);

function group(prs: IRenovatePr[], label = 'lodash'): IGroup {
  return { key: label, label, prs, counts: countByState(prs), worst: worstState(prs) };
}

describe('GroupHeader', () => {
  it('names the group and counts its pull requests', () => {
    render(<GroupHeader group={group([ pr() ])} collapsed={false} onToggle={() => {}} />);
    expect(screen.getByText('lodash')).toBeDefined();
    expect(screen.getByText('1 PR')).toBeDefined();
  });

  it('pluralises the count', () => {
    render(<GroupHeader group={group([ pr(), pr({ id: 'b' }) ])} collapsed={false} onToggle={() => {}} />);
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
    render(<GroupHeader group={group(prs)} collapsed={false} onToggle={() => {}} />);
    expect(screen.getByText('1 green')).toBeDefined();
    // An errored check counts with the failures, not on its own.
    expect(screen.getByText('2 red')).toBeDefined();
    expect(screen.getByText('1 running')).toBeDefined();
    expect(screen.getByText('1 unchecked')).toBeDefined();
  });

  it('leaves out the tallies that are zero', () => {
    const { container } = render(
      <GroupHeader group={group([ pr() ])} collapsed={false} onToggle={() => {}} />,
    );
    expect(container.querySelectorAll('.tally')).toHaveLength(1);
  });

  it('is coloured by the worst state in it', () => {
    const { container } = render(
      <GroupHeader group={group([ pr(), pr({ id: 'b', checkState: 'failure' }) ])} collapsed={false} onToggle={() => {}} />,
    );
    expect(container.querySelector('.group__header--failure')).not.toBeNull();
  });

  it('says how many are ready to merge', () => {
    render(<GroupHeader group={group([ pr(), pr({ id: 'b', isDraft: true }) ])} collapsed={false} onToggle={() => {}} />);
    expect(screen.getByText('1 ready to merge')).toBeDefined();
  });

  it('says nothing about merging when nothing is ready', () => {
    render(<GroupHeader group={group([ pr({ checkState: 'failure' }) ])} collapsed={false} onToggle={() => {}} />);
    expect(screen.queryByText(/ready to merge/u)).toBeNull();
  });

  it('reports whether it is collapsed, and asks to be toggled', () => {
    const onToggle = vi.fn();
    render(<GroupHeader group={group([ pr() ])} collapsed onToggle={onToggle} />);
    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('lodash');
  });
});
