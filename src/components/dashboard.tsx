import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { IGroup } from '../lib/selectors';
import {
  EMPTY_FILTERS,
  depTypesOf,
  filterPrs,
  groupPrs,
  managersOf,
  ownersOf,
  sortGroups,
  sortPrs,
  updateTypesPresent,
} from '../lib/selectors';
import type { DashboardStore } from '../lib/store';
import type { IViewState } from '../lib/urlState';
import { readViewState, writeViewState } from '../lib/urlState';
import { FilterBar } from './filter-bar';
import { GroupHeader } from './group-header';
import { PrRow } from './pr-row';
import { StatusFooter } from './status-footer';

export interface IDashboardProps {
  store: DashboardStore;
}

/**
 * The list, and everything that decides what it looks like.
 *
 * The view lives in the URL fragment rather than in this component, so "everything failing,
 * grouped by dependency" is a link somebody can bookmark or send.
 */
export function Dashboard({ store }: IDashboardProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [ view, setView ] = useState<IViewState>(() => readViewState(location.hash));
  const [ now, setNow ] = useState(() => Date.now());

  useEffect(() => {
    writeViewState(view);
  }, [ view ]);

  // Relative ages go stale on their own; nothing else here needs a ticking clock.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Grouping by dependency is the one view that cannot be built from titles alone: a group pull
  // request only lists its packages in its body.
  useEffect(() => {
    if (view.group === 'dependency') {
      void store.loadBodies(state.prs.filter(pr => !pr.bodyLoaded).map(pr => pr.id));
    }
  }, [ view.group, state.prs, store ]);

  const visible = useMemo(() => sortPrs(filterPrs(state.prs, view.filters), view.sort), [
    state.prs,
    view.filters,
    view.sort,
  ]);
  const groups = useMemo(
    () => sortGroups(groupPrs(visible, view.group), view.groupSort),
    [ visible, view.group, view.groupSort ],
  );

  const collapsed = new Set(view.collapsed);
  function toggleGroup(key: string): void {
    setView(current => ({
      ...current,
      collapsed: current.collapsed.includes(key) ?
        current.collapsed.filter(entry => entry !== key) :
          [ ...current.collapsed, key ],
    }));
  }

  function expand(id: string): void {
    void store.loadBodies([ id ]);
  }

  function rowsOf(prs: typeof visible, focusKey?: string): React.ReactNode {
    return prs.map(pr => (
      <PrRow key={pr.id} pr={pr} now={now} onExpand={expand} focusKey={focusKey} />
    ));
  }

  const filtersActive = JSON.stringify(view.filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="dashboard">
      <div className="dashboard__bar">
        <button
          className="button"
          type="button"
          disabled={state.loading}
          onClick={() => {
            void store.refresh();
          }}
        >
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
        {state.totalCount > state.prs.length && state.loading ?
          <span className="dashboard__progress">{state.prs.length} of {state.totalCount}</span> :
          null}
      </div>

      <FilterBar
        view={view}
        owners={ownersOf(state.prs)}
        managers={managersOf(state.prs)}
        depTypes={depTypesOf(state.prs)}
        updateTypes={updateTypesPresent(state.prs)}
        hiddenCount={state.prs.length - visible.length}
        onChange={setView}
      />

      {visible.length === 0 && !state.loading ?
          (
            <p className="dashboard__empty">
              {emptyMessage(state.prs.length, filtersActive, state.error !== undefined)}
            </p>
          ) :
        null}

      {view.group === 'none' ?
        <ul className="pr-list">{rowsOf(visible)}</ul> :
        groups.map((group: IGroup) => (
          <section key={group.key} className="group">
            <GroupHeader group={group} collapsed={collapsed.has(group.key)} onToggle={toggleGroup} />
            {collapsed.has(group.key) ?
              null :
                (
                  <ul className="pr-list">
                    {rowsOf(group.prs, view.group === 'dependency' ? group.key : undefined)}
                  </ul>
                )}
          </section>
        ))}

      <StatusFooter state={state} now={now} />
    </div>
  );
}

function emptyMessage(total: number, filtersActive: boolean, errored: boolean): string {
  if (errored) {
    return 'Nothing loaded — see the error below.';
  }
  if (total > 0 && filtersActive) {
    return 'No pull request matches these filters.';
  }
  return 'No open Renovate pull requests. Enjoy it while it lasts.';
}
