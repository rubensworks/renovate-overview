import { useState } from 'react';
import { formatAbsolute, formatRelative } from '../lib/time';
import type { ActionKind, IRenovatePr, ISettings } from '../lib/types';
import { CHECK_STATE_LABELS } from '../lib/types';
import { PrActions } from './pr-actions';
import { StatusIcon } from './status-icon';
import { UpdatePill } from './update-pill';

export interface IPrRowProps {
  pr: IRenovatePr;
  now: number;
  /**
   * Asks for the body, so the parsed dependency table can be shown. Called when the row opens.
   */
  onExpand: (id: string) => void;
  /**
   * The grouping key of the group this row is being shown under, when grouped by dependency.
   *
   * A group pull request appears under every dependency it carries, so without this it would be
   * labelled with its first package in all of them — reading as `@types/node` under a heading
   * that says `lodash`.
   */
  focusKey?: string;
  settings: ISettings;
  selected: boolean;
  onSelect: (id: string) => void;
  onAction: (kind: ActionKind, pr: IRenovatePr) => void;
}

/**
 * One dense line per pull request, with a coloured rule down its left edge.
 *
 * The dependency, not the title, is the headline: the title is a sentence about the dependency,
 * and a column of sentences is much harder to scan than a column of names.
 */
export function PrRow({ pr, now, onExpand, focusKey, settings, selected, onSelect, onAction }: IPrRowProps) {
  const [ open, setOpen ] = useState(false);
  const focused = pr.parse.updates.find(update => update.groupKey === focusKey);
  const first = focused ?? pr.parse.updates[0];
  const others = pr.parse.updates.length - 1;
  const depName = first?.depName ?? pr.parse.groupName;

  function toggle(): void {
    if (!open) {
      onExpand(pr.id);
    }
    setOpen(current => !current);
  }

  return (
    <li className={`pr pr--${pr.checkState}`}>
      <div className="pr__line">
        <input
          className="pr__select"
          type="checkbox"
          checked={selected}
          aria-label={`Select ${pr.repo} #${pr.number}`}
          onChange={() => onSelect(pr.id)}
        />
        <button
          className="pr__disclosure"
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${pr.repo} #${pr.number}` : `Expand ${pr.repo} #${pr.number}`}
          onClick={toggle}
        >
          {open ? '▾' : '▸'}
        </button>

        <StatusIcon state={pr.checkState} />

        <a className="pr__repo" href={pr.url} target="_blank" rel="noreferrer noopener">
          {pr.repo}
        </a>
        <span className="pr__number">#{pr.number}</span>

        {depName === undefined ?
          <span className="pr__dep pr__dep--unknown">Unrecognised</span> :
          <span className="pr__dep">{depName}</span>}

        {/* Merging a group pull request updates more than the dependency the row is filed under. */}
        {others > 0 ? <span className="pr__more">+{others} more</span> : null}

        {first?.currentVersion === undefined || first.newVersion === undefined ?
          null :
            (
              <span className="pr__versions">
                <code>{first.currentVersion}</code> → <code>{first.newVersion}</code>
              </span>
            )}
        {first?.currentVersion === undefined && first?.newVersion !== undefined ?
          <span className="pr__versions">→ <code>{first.newVersion}</code></span> :
          null}

        <UpdatePill updateType={pr.parse.updateType} />

        <span className="pr__title" title={pr.title}>{pr.title}</span>

        <span className="pr__flags">
          {pr.isDraft ? <span className="flag flag--draft">draft</span> : null}
          {pr.mergeable === 'CONFLICTING' ? <span className="flag flag--conflict">conflict</span> : null}
          {pr.reviewDecision === 'APPROVED' ? <span className="flag flag--approved">approved</span> : null}
          {pr.reviewDecision === 'CHANGES_REQUESTED' ?
            <span className="flag flag--changes">changes requested</span> :
            null}
          {pr.isPrivate ? <span className="flag flag--private">private</span> : null}
        </span>

        <time className="pr__age" dateTime={pr.updatedAt} title={formatAbsolute(pr.updatedAt)}>
          {formatRelative(pr.updatedAt, now)}
        </time>
      </div>

      {open ?
          (
            <div className="pr__detail">
              <dl className="pr__facts">
                <dt>Branch</dt>
                <dd><code>{pr.branch}</code> → <code>{pr.baseBranch}</code></dd>
                <dt>Opened by</dt>
                <dd>{pr.author}</dd>
                <dt>Created</dt>
                <dd title={formatAbsolute(pr.createdAt)}>{formatRelative(pr.createdAt, now)} ago</dd>
                <dt>Parsed from</dt>
                <dd>
                  {pr.parse.source}
                  {pr.bodyLoaded ? '' : ' (body not loaded)'}
                </dd>
                {pr.labels.length === 0 ?
                  null :
                    (
                      <>
                        <dt>Labels</dt>
                        <dd>{pr.labels.join(', ')}</dd>
                      </>
                    )}
              </dl>

              {pr.parse.updates.length === 0 ?
                null :
                  (
                    <table className="pr__updates">
                      <thead>
                        <tr><th>Package</th><th>Type</th><th>Update</th><th>Change</th></tr>
                      </thead>
                      <tbody>
                        {pr.parse.updates.map(update => (
                          <tr key={update.groupKey}>
                            <td>{update.depName}</td>
                            <td>{update.depType ?? '—'}</td>
                            <td>{update.updateType}</td>
                            <td>
                              {update.currentVersion ?? '?'} → {update.newVersion ?? '?'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

              {pr.checks.length === 0 ?
                <p className="pr__no-checks">{CHECK_STATE_LABELS[pr.checkState]}.</p> :
                  (
                    <ul className="pr__checks">
                      {pr.checks.map(check => (
                        <li key={check.name} className="pr__check">
                          <StatusIcon state={check.state} size={12} />
                          {check.url === undefined ?
                            <span className="pr__check-name">{check.name}</span> :
                              (
                                <a
                                  className="pr__check-name"
                                  href={check.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  {check.name}
                                </a>
                              )}
                        </li>
                      ))}
                    </ul>
                  )}

              <PrActions pr={pr} settings={settings} onAction={onAction} />

              {pr.parse.disagreements.length === 0 ?
                null :
                  (
                    <p className="pr__disagreement" role="note">
                      Sources disagree: {pr.parse.disagreements.join('; ')}
                    </p>
                  )}
            </div>
          ) :
        null}
    </li>
  );
}
