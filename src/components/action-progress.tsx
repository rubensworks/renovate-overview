import type { IActionRun } from '../lib/types';
import { ACTION_LABELS } from '../lib/types';

export interface IActionProgressProps {
  run: IActionRun;
  onDismiss: () => void;
}

const OUTCOME_GLYPHS: Record<string, string> = {
  pending: '·',
  running: '…',
  succeeded: '✓',
  failed: '✕',
  skipped: '–',
};

/**
 * The per-pull-request result of a run.
 *
 * Every attempt is listed, including the ones that failed and why. A bulk action that half worked
 * is the normal case, and the only useful thing to show is exactly which half.
 */
export function ActionProgress({ run, onDismiss }: IActionProgressProps) {
  const done = run.results.filter(result => result.outcome !== 'pending' && result.outcome !== 'running');
  const failed = run.results.filter(result => result.outcome === 'failed');

  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress__head">
        <strong>{ACTION_LABELS[run.kind]}</strong>
        <span className="progress__count">
          {done.length} of {run.results.length}
          {failed.length > 0 ? `, ${failed.length} failed` : ''}
        </span>
        {run.running ? <span className="progress__count">working…</span> : null}
        <span className="progress__spacer" />
        {run.running ?
          null :
          <button className="button button--ghost" type="button" onClick={onDismiss}>Dismiss</button>}
      </div>

      {run.stoppedReason === undefined ?
        null :
        <p className="progress__stopped" role="alert">{run.stoppedReason}</p>}

      <ul className="progress__list">
        {run.results.map(result => (
          <li key={result.prId} className={`progress__item progress__item--${result.outcome}`}>
            <span className="progress__glyph">{OUTCOME_GLYPHS[result.outcome]}</span>
            <span className="progress__label">{result.label}</span>
            {result.message === undefined ?
              null :
              <span className="progress__message">{result.message}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
