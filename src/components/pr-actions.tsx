import { isActionAvailable, mergeMethodFor } from '../lib/actions';
import type { ActionKind, IRenovatePr, ISettings } from '../lib/types';
import { ACTION_LABELS, MERGE_METHOD_LABELS } from '../lib/types';

export interface IPrActionsProps {
  pr: IRenovatePr;
  settings: ISettings;
  onAction: (kind: ActionKind, pr: IRenovatePr) => void;
}

const ORDER: ActionKind[] = [ 'merge', 'auto-merge', 'approve', 'rebase', 'rerun', 'close' ];

/**
 * The per-pull-request actions, shown inside an expanded row.
 *
 * Absent entirely while the app is read-only, so a token with no write permissions never meets a
 * button that can only fail.
 */
export function PrActions({ pr, settings, onAction }: IPrActionsProps) {
  if (!settings.writeActions) {
    return (
      <p className="pr__readonly">
        Read-only. Turn on write actions in the settings to merge, approve, rebase or close.
      </p>
    );
  }

  return (
    <div className="pr__actions">
      {ORDER.filter(kind => isActionAvailable(kind, pr)).map(kind => (
        <button
          key={kind}
          className={`button ${kind === 'close' ? 'button--danger' : ''}`}
          type="button"
          title={kind === 'merge' ? `Using ${MERGE_METHOD_LABELS[mergeMethodFor(pr.repo, settings)]}` : undefined}
          onClick={() => onAction(kind, pr)}
        >
          {ACTION_LABELS[kind]}
        </button>
      ))}
    </div>
  );
}
