import { quotaRatio } from '../lib/store';
import { formatRelative, formatUntil } from '../lib/time';
import type { IDashboardState } from '../lib/types';

export interface IStatusFooterProps {
  state: IDashboardState;
  now: number;
}

/**
 * The status bar: what the dashboard is doing, what went wrong, and what quota is left.
 */
export function StatusFooter({ state, now }: IStatusFooterProps) {
  const { rateLimit } = state;
  const ratio = quotaRatio(rateLimit);
  const level = ratio > 0.25 ? 'ok' : (ratio > 0.05 ? 'warn' : 'low');

  return (
    <div className="status">
      <span className={`status__dot status__dot--${state.loading ? 'busy' : 'idle'}`} />
      <span className="status__item">
        {state.loading ? `Loading… ${state.prs.length} so far` : `${state.prs.length} open`}
      </span>

      {state.lastRefreshedAt === undefined ?
        null :
          (
            <span className="status__item status__item--muted">
              updated {formatRelative(new Date(state.lastRefreshedAt).toISOString(), now)} ago
            </span>
          )}

      {state.truncated.map(scope => (
        <span key={scope.label} className="status__item status__item--warn">
          {scope.label} has {scope.count}+ matches — GitHub search stops at 1000, so some are missing
        </span>
      ))}

      <span className="status__spacer" />

      {state.error === undefined ?
        null :
        <span className="status__item status__item--error" title={state.error}>{state.error}</span>}

      {rateLimit === undefined ?
        <span className="status__item status__item--muted">GraphQL quota unknown</span> :
          (
            <span className={`status__quota status__quota--${level}`}>
              <span className="status__quota-bar">
                <span className="status__quota-fill" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
              </span>
              {rateLimit.remaining}/{rateLimit.limit} GraphQL points · last query cost{' '}
              {rateLimit.cost} · resets in {formatUntil(rateLimit.resetAt, now)}
            </span>
          )}
    </div>
  );
}
