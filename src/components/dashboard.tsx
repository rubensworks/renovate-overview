import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DashboardStore } from '../lib/store';
import { PrRow } from './pr-row';
import { StatusFooter } from './status-footer';

export interface IDashboardProps {
  store: DashboardStore;
}

/**
 * The flat list of open dependency pull requests.
 *
 * Grouping, sorting and filtering land in a later milestone; what this already gives is the whole
 * backlog on one page, each line coloured by its CI result.
 */
export function Dashboard({ store }: IDashboardProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [ now, setNow ] = useState(() => Date.now());

  // Relative ages go stale on their own; nothing else here needs a ticking clock.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

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

      {state.prs.length === 0 && !state.loading ?
          (
            <p className="dashboard__empty">
              {state.error === undefined ?
                'No open Renovate pull requests. Enjoy it while it lasts.' :
                'Nothing loaded — see the error below.'}
            </p>
          ) :
            <ul className="pr-list">{state.prs.map(pr => <PrRow key={pr.id} pr={pr} now={now} />)}</ul>}

      <StatusFooter state={state} now={now} />
    </div>
  );
}
