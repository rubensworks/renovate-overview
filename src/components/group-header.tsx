import { useEffect, useState } from 'react';
import { copyText, formatGroupAsText } from '../lib/clipboard';
import type { GroupMode, IGroup } from '../lib/selectors';
import { greenIn } from '../lib/selectors';
import { StatusIcon } from './status-icon';

/**
 * How long the copy button reports what happened before going back to offering the copy.
 */
export const COPIED_FEEDBACK_MS = 2000;

type CopyState = 'copied' | 'failed' | 'idle';

const COPY_LABELS: Record<CopyState, string> = {
  copied: 'Copied',
  failed: 'Copy failed',
  idle: 'Copy as text',
};

export interface IGroupHeaderProps {
  group: IGroup;
  /**
   * How the group was formed, which decides what a copied line says: the heading already carries
   * what every pull request in the group shares, so the lines carry what differs.
   */
  mode: GroupMode;
  collapsed: boolean;
  onToggle: (key: string) => void;
  /**
   * Adds pull requests to the selection. The green-only shortcut is the single most useful thing
   * on this header: it is what turns a dependency group into one merge.
   */
  onSelect: (ids: string[]) => void;
  /**
   * Leaves this repository out of the dashboard from now on. Only handed in when the groups are
   * repositories, since that is the only mode in which a group *is* one repository.
   */
  onExclude?: (repo: string) => void;
}

/**
 * A group's heading, carrying the roll-up that makes a backlog readable: how many pull requests
 * are in it, and how they split between passing, failing and still running.
 */
export function GroupHeader({ group, mode, collapsed, onToggle, onSelect, onExclude }: IGroupHeaderProps) {
  const green = greenIn(group.prs).length;
  const [ copyState, setCopyState ] = useState<CopyState>('idle');

  // Whatever it last reported goes away on its own. Settling back to `idle` when it is already
  // `idle` is a no-op React bails out of, so this arms exactly one timer per copy.
  useEffect(() => {
    const timer = setTimeout(() => setCopyState('idle'), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [ copyState ]);

  return (
    <div className={`group__header group__header--${group.worst}`}>
      <button
        className="group__toggle"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggle(group.key)}
      >
        {collapsed ? '▸' : '▾'}
      </button>
      <StatusIcon state={group.worst} />
      <span className="group__label">{group.label}</span>
      <span className="group__count">
        {group.prs.length === 1 ? '1 PR' : `${group.prs.length} PRs`}
      </span>
      <span className="group__breakdown">
        {group.counts.success > 0 ? <span className="tally tally--success">{group.counts.success} green</span> : null}
        {group.counts.failure + group.counts.error > 0 ?
          <span className="tally tally--failure">{group.counts.failure + group.counts.error} red</span> :
          null}
        {group.counts.pending > 0 ? <span className="tally tally--pending">{group.counts.pending} running</span> : null}
        {group.counts.none > 0 ? <span className="tally tally--none">{group.counts.none} unchecked</span> : null}
      </span>
      <span className="group__spacer" />
      <button
        className="button button--ghost group__copy"
        type="button"
        title="Copy this group's name and repositories as plain text"
        onClick={() => {
          void copyText(formatGroupAsText(group, mode)).then(ok => setCopyState(ok ? 'copied' : 'failed'));
        }}
      >
        {COPY_LABELS[copyState]}
      </button>
      <button
        className="button button--ghost"
        type="button"
        onClick={() => onSelect(group.prs.map(pr => pr.id))}
      >
        Select all
      </button>
      {green > 0 ?
          (
            <button
              className="button button--ghost group__green"
              type="button"
              onClick={() => onSelect(greenIn(group.prs).map(pr => pr.id))}
            >
              Select {green} ready to merge
            </button>
          ) :
        null}
      {onExclude === undefined ?
        null :
          (
            <button
              className="button button--ghost"
              type="button"
              title={`Leave ${group.label} out of the dashboard, until you remove it from the settings`}
              onClick={() => onExclude(group.label)}
            >
              Exclude
            </button>
          )}
    </div>
  );
}
