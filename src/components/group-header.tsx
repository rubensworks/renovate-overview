import type { IGroup } from '../lib/selectors';
import { greenIn } from '../lib/selectors';
import { StatusIcon } from './status-icon';

export interface IGroupHeaderProps {
  group: IGroup;
  collapsed: boolean;
  onToggle: (key: string) => void;
}

/**
 * A group's heading, carrying the roll-up that makes a backlog readable: how many pull requests
 * are in it, and how they split between passing, failing and still running.
 */
export function GroupHeader({ group, collapsed, onToggle }: IGroupHeaderProps) {
  const green = greenIn(group.prs).length;
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
      {green > 0 ? <span className="group__green">{green} ready to merge</span> : null}
    </div>
  );
}
