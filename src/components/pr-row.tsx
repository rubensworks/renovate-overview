import { useState } from 'react';
import { formatAbsolute, formatRelative } from '../lib/time';
import type { IRenovatePr } from '../lib/types';
import { CHECK_STATE_LABELS } from '../lib/types';
import { StatusIcon } from './status-icon';

export interface IPrRowProps {
  pr: IRenovatePr;
  now: number;
}

/**
 * One dense line per pull request, with a coloured rule down its left edge.
 *
 * Expanding it shows the individual checks, each linking to its own logs. The dependency the pull
 * request updates lands here once the parser does, in the next milestone; until then the title
 * carries that information as GitHub wrote it.
 */
export function PrRow({ pr, now }: IPrRowProps) {
  const [ open, setOpen ] = useState(false);

  return (
    <li className={`pr pr--${pr.checkState}`}>
      <div className="pr__line">
        <button
          className="pr__disclosure"
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${pr.repo} #${pr.number}` : `Expand ${pr.repo} #${pr.number}`}
          onClick={() => setOpen(current => !current)}
        >
          {open ? '▾' : '▸'}
        </button>

        <StatusIcon state={pr.checkState} />

        <a className="pr__repo" href={pr.url} target="_blank" rel="noreferrer noopener">
          {pr.repo}
        </a>
        <span className="pr__number">#{pr.number}</span>
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
                {pr.labels.length === 0 ?
                  null :
                    (
                      <>
                        <dt>Labels</dt>
                        <dd>{pr.labels.join(', ')}</dd>
                      </>
                    )}
              </dl>

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
            </div>
          ) :
        null}
    </li>
  );
}
