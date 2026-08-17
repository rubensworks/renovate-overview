import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PrRow } from '../../src/components/pr-row';
import type { IRenovatePr } from '../../src/lib/types';
import { pr } from '../fixtures';

afterEach(cleanup);

const NOW = Date.parse('2026-08-17T12:00:00Z');

function renderRow(overrides: Partial<IRenovatePr> = {}): void {
  render(<PrRow pr={pr(overrides)} now={NOW} />);
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

  it('links the repository straight to the pull request', () => {
    renderRow();
    const link = screen.getByRole('link', { name: 'rubensworks/jbr.js' });
    expect(link.getAttribute('href')).toBe('https://github.com/rubensworks/jbr.js/pull/42');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('carries its check state as a class, for the coloured rule down the margin', () => {
    const { container } = render(<PrRow pr={pr({ checkState: 'failure' })} now={NOW} />);
    expect(container.querySelector('.pr')?.classList.contains('pr--failure')).toBe(true);
  });

  it('shows no flags on an ordinary green pull request', () => {
    const { container } = render(<PrRow pr={pr()} now={NOW} />);
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
