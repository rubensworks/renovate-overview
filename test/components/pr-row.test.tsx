import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrRow } from '../../src/components/pr-row';
import type { IRenovatePr } from '../../src/lib/types';
import { pr } from '../fixtures';

const GROUP_PARSE = {
  updates: [
    { depName: 'lodash', groupKey: 'lodash', currentVersion: '4.17.20', newVersion: '4.17.21', updateType: 'patch' as const, depType: 'dependencies', source: 'body' as const },
    { depName: '@types/node', groupKey: 'types-node', currentVersion: '20.11.4', newVersion: '20.11.5', updateType: 'patch' as const, depType: 'devDependencies', source: 'body' as const },
  ],
  isGroupPr: true,
  groupName: 'all non-major dependencies',
  updateType: 'patch' as const,
  source: 'body' as const,
  disagreements: [],
};

afterEach(cleanup);

const NOW = Date.parse('2026-08-17T12:00:00Z');

function renderRow(overrides: Partial<IRenovatePr> = {}, onExpand = (): void => {}): void {
  render(<PrRow pr={pr(overrides)} now={NOW} onExpand={onExpand} />);
}

function expand(): void {
  fireEvent.click(screen.getByRole('button', { name: /Expand/u }));
}

describe('PrRow', () => {
  it('lists the repository, number, title and age', () => {
    renderRow();
    expect(screen.getByText('rubensworks/jbr.js')).toBeDefined();
    expect(screen.getByText('#42')).toBeDefined();
    expect(screen.getByText('Update dependency lodash to v4.17.21')).toBeDefined();
    expect(screen.getByText('7d')).toBeDefined();
  });

  it('leads with the dependency, since a column of names scans far better than one of sentences', () => {
    renderRow();
    expect(screen.getByText('lodash')).toBeDefined();
  });

  it('falls back to the group name when the packages are not known yet', () => {
    renderRow({ title: 'Update all non-major dependencies', branch: 'renovate/all-minor-patch' });
    expect(screen.getByText('all non-major dependencies')).toBeDefined();
  });

  it('says a pull request is unrecognised rather than dropping it', () => {
    renderRow({ title: 'Merge branch master into develop', branch: 'feature/x' });
    expect(screen.getByText('Unrecognised')).toBeDefined();
  });

  it('labels a group pull request with the dependency whose group it is being shown in', () => {
    render(<PrRow pr={pr({ parse: GROUP_PARSE })} now={NOW} onExpand={() => {}} focusKey="types-node" />);
    expect(screen.getByText('@types/node')).toBeDefined();
    expect(screen.queryByText('lodash')).toBeNull();
    // Still says it carries more, whichever of them the row is filed under.
    expect(screen.getByText('+1 more')).toBeDefined();
  });

  it('falls back to the first package when the group is not a dependency group', () => {
    render(<PrRow pr={pr({ parse: GROUP_PARSE })} now={NOW} onExpand={() => {}} focusKey="something-else" />);
    expect(screen.getByText('lodash')).toBeDefined();
  });

  it('badges a group pull request with how much else it carries', () => {
    renderRow({ parse: GROUP_PARSE });
    expect(screen.getByText('+1 more')).toBeDefined();
  });

  it('does not badge a pull request that carries one package', () => {
    renderRow();
    expect(screen.queryByText(/more$/u)).toBeNull();
  });

  it('shows the version change when both versions are known', () => {
    renderRow({ parse: GROUP_PARSE });
    expect(screen.getByText('4.17.20')).toBeDefined();
    expect(screen.getByText('4.17.21')).toBeDefined();
  });

  it('shows just the new version when the current one is not known', () => {
    const { container } = render(<PrRow pr={pr()} now={NOW} onExpand={() => {}} />);
    expect(container.querySelector('.pr__versions')?.textContent).toBe('→ 4.17.21');
  });

  it('shows the update type as a pill, and nothing when it is unknown', () => {
    renderRow({ parse: GROUP_PARSE });
    expect(screen.getByText('patch')).toBeDefined();
    cleanup();
    const { container } = render(<PrRow pr={pr()} now={NOW} onExpand={() => {}} />);
    expect(container.querySelector('.pill')).toBeNull();
  });

  it('links the repository straight to the pull request', () => {
    renderRow();
    const link = screen.getByRole('link', { name: 'rubensworks/jbr.js' });
    expect(link.getAttribute('href')).toBe('https://github.com/rubensworks/jbr.js/pull/42');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('carries its check state as a class, for the coloured rule down the margin', () => {
    const { container } = render(<PrRow pr={pr({ checkState: 'failure' })} now={NOW} onExpand={() => {}} />);
    expect(container.querySelector('.pr')?.classList.contains('pr--failure')).toBe(true);
  });

  it('shows no flags on an ordinary green pull request', () => {
    const { container } = render(<PrRow pr={pr()} now={NOW} onExpand={() => {}} />);
    expect(container.querySelectorAll('.flag')).toHaveLength(0);
  });

  it('flags a draft, a conflict, a review decision and a private repository', () => {
    renderRow({
      isDraft: true,
      mergeable: 'CONFLICTING',
      reviewDecision: 'APPROVED',
      isPrivate: true,
    });
    expect(screen.getByText('draft')).toBeDefined();
    expect(screen.getByText('conflict')).toBeDefined();
    expect(screen.getByText('approved')).toBeDefined();
    expect(screen.getByText('private')).toBeDefined();
  });

  it('flags a requested change', () => {
    renderRow({ reviewDecision: 'CHANGES_REQUESTED' });
    expect(screen.getByText('changes requested')).toBeDefined();
  });

  it('says nothing about mergeability while GitHub is still working it out', () => {
    renderRow({ mergeable: 'UNKNOWN' });
    expect(screen.queryByText('conflict')).toBeNull();
  });

  it('stays collapsed until asked', () => {
    renderRow();
    expect(screen.queryByText('Branch')).toBeNull();
    expand();
    expect(screen.getByText('Branch')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Collapse/u }));
    expect(screen.queryByText('Branch')).toBeNull();
  });

  it('asks for the body the first time it is opened, and not again', () => {
    const onExpand = vi.fn();
    renderRow({}, onExpand);
    expand();
    expect(onExpand).toHaveBeenCalledWith('PR_1');
    fireEvent.click(screen.getByRole('button', { name: /Collapse/u }));
    fireEvent.click(screen.getByRole('button', { name: /Expand/u }));
    expect(onExpand).toHaveBeenCalledTimes(2);
  });

  it('says which source the parse came from, and whether the body is in it', () => {
    renderRow();
    expand();
    expect(screen.getByText(/^title/u).textContent).toContain('(body not loaded)');
    cleanup();
    renderRow({ parse: GROUP_PARSE, bodyLoaded: true });
    expand();
    expect(screen.getByText('body')).toBeDefined();
  });

  it('shows the parsed dependency table once there is one', () => {
    renderRow({ parse: GROUP_PARSE });
    expand();
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('devDependencies')).toBeDefined();
  });

  it('shows question marks for versions a row does not carry', () => {
    renderRow({ parse: { ...GROUP_PARSE, updates: [
      { depName: 'x', groupKey: 'x', updateType: 'patch', source: 'body' },
    ]}});
    expand();
    expect(screen.getByText('? → ?')).toBeDefined();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('shows no table when nothing was parsed', () => {
    renderRow({ title: 'Merge branch master into develop', branch: 'feature/x' });
    expand();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('surfaces a disagreement between the sources instead of hiding it', () => {
    renderRow({ title: 'Update dependency lodash to v4.17.21', branch: 'renovate/types-node-20.x' });
    expand();
    expect(screen.getByRole('note').textContent).toContain('branch says types-node, title says lodash');
  });

  it('says nothing when the sources agree', () => {
    renderRow();
    expand();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows the branch, author, age and labels when expanded', () => {
    renderRow();
    expand();
    expect(screen.getByText('renovate/lodash-4.x')).toBeDefined();
    expect(screen.getByText('master')).toBeDefined();
    expect(screen.getByText('renovate[bot]')).toBeDefined();
    expect(screen.getByText('dependencies')).toBeDefined();
  });

  it('omits the labels row when there are none', () => {
    renderRow({ labels: []});
    expand();
    expect(screen.queryByText('Labels')).toBeNull();
  });

  it('links each check to its own logs', () => {
    renderRow();
    expand();
    const link = screen.getByRole('link', { name: 'build' });
    expect(link.getAttribute('href')).toBe('https://ci');
  });

  it('renders a check with no link as plain text', () => {
    renderRow({ checks: [{ name: 'build', state: 'success', url: undefined }]});
    expand();
    expect(screen.queryByRole('link', { name: 'build' })).toBeNull();
    expect(screen.getByText('build')).toBeDefined();
  });

  it('says a commit has no checks rather than showing an empty list', () => {
    renderRow({ checks: [], checkState: 'none' });
    expand();
    expect(screen.getByText('No checks.')).toBeDefined();
  });
});
