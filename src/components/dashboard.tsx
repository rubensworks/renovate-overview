import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { normalizeRepo } from '../lib/exclusions';
import { applyOverallStatus } from '../lib/favicon';
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
  worstState,
} from '../lib/selectors';
import type { DashboardStore } from '../lib/store';
import type { ActionKind, IRenovatePr, ISettings } from '../lib/types';
import { ACTION_LABELS } from '../lib/types';
import type { IViewState } from '../lib/urlState';
import { readViewState, writeViewState } from '../lib/urlState';
import { ActionProgress } from './action-progress';
import { BulkBar } from './bulk-bar';
import { ConfirmDialog } from './confirm-dialog';
import { FilterBar } from './filter-bar';
import { GroupHeader } from './group-header';
import { PrRow } from './pr-row';
import { StatusFooter } from './status-footer';

export interface IDashboardProps {
  store: DashboardStore;
  settings: ISettings;
  /**
   * Persists a settings change made from the list itself, which is only ever excluding a
   * repository.
   */
  onSettingsChange: (settings: ISettings) => void;
}

/**
 * An action waiting to be confirmed, and what it will be applied to.
 */
interface IPending {
  kind: ActionKind;
  prs: IRenovatePr[];
}

/**
 * The list, and everything that decides what it looks like.
 *
 * The view lives in the URL fragment rather than in this component, so "everything failing,
 * grouped by dependency" is a link somebody can bookmark or send.
 */
export function Dashboard({ store, settings, onSettingsChange }: IDashboardProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [ view, setView ] = useState<IViewState>(() => readViewState(location.hash));
  const [ now, setNow ] = useState(() => Date.now());
  const [ pending, setPending ] = useState<IPending | undefined>();
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    writeViewState(view);
  }, [ view ]);

  // A pinned tab is a passive monitor, so the whole state has to fit in a favicon and a title.
  useEffect(() => {
    applyOverallStatus(
      worstState(state.prs),
      state.prs.length,
      state.prs.filter(pr => pr.checkState === 'failure' || pr.checkState === 'error').length,
    );
  }, [ state.prs ]);

  // Shortcuts for the things done over and over while working through a backlog. Nothing fires
  // while the user is typing into a field, and nothing here writes to GitHub.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      const typing = target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === 'Escape') {
        setPending(undefined);
        return;
      }
      if (typing) {
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'r') {
        void store.refresh();
      } else if (event.key === 'g') {
        setView(current => ({
          ...current,
          group: current.group === 'dependency' ? 'none' : 'dependency',
        }));
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ store ]);

  // Relative ages go stale on their own; nothing else here needs a ticking clock.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

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

  // A review decision costs a request of its own on REST, so it is only fetched for a row
  // somebody has actually opened.
  function expand(id: string): void {
    void store.loadReviewDecision(id);
  }

  const selected = new Set(state.selected);

  // Excluding a repository is a settings change like any other, so it is undone in the settings
  // like any other. The rows go the moment the store is reconfigured; the search stops asking for
  // them on the next refresh.
  function excludeRepo(repo: string): void {
    const key = repo.toLowerCase();
    if (settings.excludedRepos.some(entry => normalizeRepo(entry) === key)) {
      return;
    }
    onSettingsChange({ ...settings, excludedRepos: [ ...settings.excludedRepos, repo ]});
  }

  function select(ids: string[]): void {
    store.setSelection([ ...state.selected, ...ids ]);
  }

  // Every write goes through a confirmation that names it and counts what it will touch.
  function confirm(kind: ActionKind, prs: IRenovatePr[]): void {
    setPending({ kind, prs });
  }

  function rowsOf(prs: typeof visible, focusKey?: string): React.ReactNode {
    return prs.map(pr => (
      <PrRow
        key={pr.id}
        pr={pr}
        now={now}
        onExpand={expand}
        focusKey={focusKey}
        settings={settings}
        selected={selected.has(pr.id)}
        onSelect={id => store.toggleSelection(id)}
        onAction={(kind, target) => confirm(kind, [ target ])}
      />
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

      <BulkBar
        selectedCount={state.selected.length}
        droppedCount={state.droppedFromSelection}
        settings={settings}
        onAction={kind => confirm(kind, state.prs.filter(pr => selected.has(pr.id)))}
        onClear={() => store.setSelection([])}
      />

      {state.actionRun === undefined ?
        null :
        <ActionProgress run={state.actionRun} onDismiss={() => store.clearActionRun()} />}

      <FilterBar
        view={view}
        owners={ownersOf(state.prs)}
        managers={managersOf(state.prs)}
        depTypes={depTypesOf(state.prs)}
        updateTypes={updateTypesPresent(state.prs)}
        hiddenCount={state.prs.length - visible.length}
        onChange={setView}
        searchRef={searchRef}
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
            <GroupHeader
              group={group}
              mode={view.group}
              collapsed={collapsed.has(group.key)}
              onToggle={toggleGroup}
              onSelect={select}
              onExclude={view.group === 'repo' ? excludeRepo : undefined}
            />
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

      {pending === undefined ?
        null :
          (
            <ConfirmDialog
              title={`${ACTION_LABELS[pending.kind]}?`}
              detail={describePending(pending)}
              confirmLabel={ACTION_LABELS[pending.kind]}
              danger={pending.kind === 'close'}
              onConfirm={() => {
                void store.runActions(pending.kind, pending.prs);
                setPending(undefined);
              }}
              onCancel={() => setPending(undefined)}
            />
          )}
    </div>
  );
}

// Naming the repositories, up to a point: a list of two hundred is not a confirmation, it is a
// wall, so past a handful the count does the talking.
function describePending({ kind, prs }: IPending): React.ReactNode {
  const named = prs.slice(0, 5).map(pr => `${pr.repo}#${pr.number}`);
  const rest = prs.length - named.length;
  return (
    <>
      <p>
        {ACTION_LABELS[kind]} on {prs.length === 1 ? '1 pull request' : `${prs.length} pull requests`}:
        {' '}{named.join(', ')}{rest > 0 ? `, and ${rest} more` : ''}.
      </p>
      {kind === 'close' ?
          (
            <p className="modal__warning">
              Renovate reads a closed pull request as “never offer this update again”, and will not
              raise it a second time unless its configuration changes.
            </p>
          ) :
        null}
      {kind === 'merge' && prs.length > 1 ?
        <p>They are merged one at a time, and the queue stops early if several fail in a row.</p> :
        null}
    </>
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
