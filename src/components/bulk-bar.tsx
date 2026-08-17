import type { ActionKind, ISettings } from '../lib/types';
import { ACTION_LABELS, BULK_ACTIONS } from '../lib/types';

export interface IBulkBarProps {
  selectedCount: number;
  droppedCount: number;
  settings: ISettings;
  onAction: (kind: ActionKind) => void;
  onClear: () => void;
}

/**
 * What can be done to the current selection.
 *
 * Only appears once something is selected, so it costs nothing while browsing.
 */
export function BulkBar({ selectedCount, droppedCount, settings, onAction, onClear }: IBulkBarProps) {
  if (selectedCount === 0 && droppedCount === 0) {
    return null;
  }

  return (
    <div className="bulk">
      <strong className="bulk__count">
        {selectedCount === 1 ? '1 selected' : `${selectedCount} selected`}
      </strong>

      {droppedCount > 0 ?
          (
            <span className="bulk__dropped" role="status">
              {droppedCount === 1 ?
                '1 selected pull request has since gone' :
                `${droppedCount} selected pull requests have since gone`}
            </span>
          ) :
        null}

      {settings.writeActions ?
        BULK_ACTIONS.map(kind => (
          <button
            key={kind}
            className="button"
            type="button"
            disabled={selectedCount === 0}
            onClick={() => onAction(kind)}
          >
            {ACTION_LABELS[kind]} selected
          </button>
        )) :
        <span className="bulk__readonly">Read-only — turn on write actions in the settings.</span>}

      <span className="bulk__spacer" />
      <button className="button button--ghost" type="button" onClick={onClear}>Clear selection</button>
    </div>
  );
}
