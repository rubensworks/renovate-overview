import { quotaRatio } from '../lib/store';
import { formatRelative, formatUntilUnix } from '../lib/time';
import type { IDashboardState } from '../lib/types';

export interface IStatusFooterProps {
  state: IDashboardState;
  now: number;
}

/**
 * The status bar: what the dashboard is doing, what went wrong, and what quota is left.
 */
export function StatusFooter({ state, now }: IStatusFooterProps) {
  const { rateLimit, searchRateLimit } = state;
  const ratio = quotaRatio(rateLimit);
  const level = ratio > 0.25 ? 'ok' : (ratio > 0.05 ? 'warn' : 'low');
  const holdUntil = state.backoffUntil;

  let polling = 'Polling';
  let dot = 'idle';
  if (state.loading) {
    polling = `Loading… ${state.prs.length} so far`;
    dot = 'busy';
  } else if (state.paused) {
    polling = 'Paused — tab is hidden';
    dot = 'paused';
  } else if (holdUntil !== undefined && holdUntil > now) {
    polling = `${state.backoffReason ?? 'Backing off'} (${formatUntilUnix(holdUntil / 1000, now)})`;
    dot = 'paused';
  } else {
    polling = `${state.prs.length} open`;
  }

  return (
    <div className="status">
      <span className={`status__dot status__dot--${dot}`} />
      <span className="status__item">{polling}</span>

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
        <span className="status__item status__item--muted">API quota unknown</span> :
          (
            <span className={`status__quota status__quota--${level}`}>
              <span className="status__quota-bar">
                <span className="status__quota-fill" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
              </span>
              {rateLimit.remaining}/{rateLimit.limit} API calls left · resets in{' '}
              {formatUntilUnix(rateLimit.reset, now)}
              {searchRateLimit === undefined ?
                null :
                <> · {searchRateLimit.remaining}/{searchRateLimit.limit} searches</>}
            </span>
          )}
    </div>
  );
}
