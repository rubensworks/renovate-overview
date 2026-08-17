import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { IFilterBarProps } from '../../src/components/filter-bar';
import { FilterBar } from '../../src/components/filter-bar';
import type { IViewState } from '../../src/lib/urlState';
import { DEFAULT_VIEW } from '../../src/lib/urlState';

afterEach(cleanup);

function renderBar(overrides: Partial<IFilterBarProps> = {}): IViewState[] {
  const changes: IViewState[] = [];
  const props: IFilterBarProps = {
    view: DEFAULT_VIEW,
    owners: [ 'comunica', 'rubensworks' ],
    managers: [],
    depTypes: [],
    updateTypes: [ 'major', 'patch' ],
    hiddenCount: 0,
    onChange: next => changes.push(next),
    ...overrides,
  };
  render(<FilterBar {...props} />);
  return changes;
}

describe('FilterBar', () => {
  it('types into the free-text filter', () => {
    const changes = renderBar();
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'lodash' }});
    expect(changes.at(-1)?.filters.query).toBe('lodash');
  });

  it('changes the grouping and the sort', () => {
    const changes = renderBar();
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'dependency' }});
    expect(changes.at(-1)?.group).toBe('dependency');
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'status' }});
    expect(changes.at(-1)?.sort).toBe('status');
  });

  it('offers a group order only once there are groups to order', () => {
    renderBar();
    expect(screen.queryByLabelText('Groups by')).toBeNull();
    cleanup();
    const changes = renderBar({ view: { ...DEFAULT_VIEW, group: 'repo' }});
    fireEvent.change(screen.getByLabelText('Groups by'), { target: { value: 'name' }});
    expect(changes.at(-1)?.groupSort).toBe('name');
  });

  it.each([
    [ 'Failing', 'onlyFailing' ],
    [ 'Passing', 'onlyPassing' ],
    [ 'Conflicting', 'onlyConflicting' ],
    [ 'Mergeable', 'onlyMergeable' ],
    [ 'No drafts', 'hideDrafts' ],
    [ 'I can merge', 'onlyMergeableByMe' ],
  ])('toggles %s', (label, key) => {
    const changes = renderBar();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(changes.at(-1)?.filters[key as 'onlyFailing']).toBe(true);
  });

  it('reports a toggle that is on, and turns it back off', () => {
    const changes = renderBar({
      view: { ...DEFAULT_VIEW, filters: { ...DEFAULT_VIEW.filters, onlyFailing: true }},
    });
    const button = screen.getByRole('button', { name: 'Failing' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(changes.at(-1)?.filters.onlyFailing).toBe(false);
  });

  it('filters by owner and by update type', () => {
    const changes = renderBar();
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'comunica' }});
    expect(changes.at(-1)?.filters.owner).toBe('comunica');
    fireEvent.change(screen.getByLabelText('Update type'), { target: { value: 'major' }});
    expect(changes.at(-1)?.filters.updateType).toBe('major');
  });

  it('offers a manager filter only when a manager was actually recognised', () => {
    renderBar();
    expect(screen.queryByLabelText('Manager')).toBeNull();
    cleanup();
    const changes = renderBar({ managers: [ 'github-actions' ]});
    fireEvent.change(screen.getByLabelText('Manager'), { target: { value: 'github-actions' }});
    expect(changes.at(-1)?.filters.manager).toBe('github-actions');
  });

  it('offers a dependency-type filter only when a body has supplied one', () => {
    renderBar();
    expect(screen.queryByLabelText('Dependency type')).toBeNull();
    cleanup();
    const changes = renderBar({ depTypes: [ 'devDependencies' ]});
    fireEvent.change(screen.getByLabelText('Dependency type'), { target: { value: 'devDependencies' }});
    expect(changes.at(-1)?.filters.depType).toBe('devDependencies');
  });

  it('says how much the filters are hiding', () => {
    renderBar({ hiddenCount: 0 });
    expect(screen.queryByText(/hidden by filters/u)).toBeNull();
    cleanup();
    renderBar({ hiddenCount: 12 });
    expect(screen.getByText('12 hidden by filters')).toBeDefined();
  });
});
