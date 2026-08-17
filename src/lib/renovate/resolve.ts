import type { IParseResult, IRenovatePr, IRenovateResolution, UpdateSource, UpdateType } from '../types';
import { parseBody } from './parseBody';
import { parseBranch } from './parseBranch';
import { parseTitle } from './parseTitle';

export { normalizeKey } from './key';
export type { IRenovateResolution } from '../types';

// A parser has said something useful if it named a dependency, recognised a group, or worked out
// what kind of update this is. A title like `Update all non-major dependencies` names nothing yet
// still tells us a great deal.
function saysSomething(parsed: IParseResult): boolean {
  return parsed.updates.length > 0 || parsed.isGroupPr || parsed.updateType !== 'unknown';
}

function keysOf(parsed: IParseResult): string {
  return parsed.updates.map(update => update.groupKey).join(', ');
}

/**
 * Combines the three parsers, in the order that trusts the most specific source first.
 *
 * Precedence is body, then title, then branch. The body is authoritative — it lists every package
 * of a group and states both versions — but it is only there once it has been fetched, so the
 * title carries the list until then and the branch catches the titles a custom template mangles.
 * @param pr A pull request.
 * @param body Its body, when one has been loaded.
 */
export function resolveUpdates(pr: IRenovatePr, body?: string): IRenovateResolution {
  const fromBody = body === undefined ? undefined : parseBody(body);
  const fromTitle = parseTitle(pr.title);
  const fromBranch = parseBranch(pr.branch);

  const ordered: [UpdateSource, IParseResult | undefined][] = [
    [ 'body', fromBody ],
    [ 'title', fromTitle ],
    [ 'branch', fromBranch ],
  ];
  const winner = ordered.find(([ , parsed ]) => parsed !== undefined && saysSomething(parsed));

  if (winner === undefined) {
    return {
      updates: [],
      isGroupPr: false,
      groupName: undefined,
      updateType: 'unknown',
      source: 'unknown',
      disagreements: [],
    };
  }

  const [ source, parsed ] = <[UpdateSource, IParseResult]> winner;
  const disagreements: string[] = [];
  for (const [ otherSource, other ] of ordered) {
    if (otherSource === source || other === undefined || other.updates.length === 0) {
      continue;
    }
    if (parsed.updates.length > 0 && keysOf(other) !== keysOf(parsed)) {
      disagreements.push(`${otherSource} says ${keysOf(other)}, ${source} says ${keysOf(parsed)}`);
    }
  }

  // The group flag and the group's name are taken from wherever they are known, since the body
  // lists a group's members without ever naming the group, and a title does the reverse.
  return {
    updates: parsed.updates,
    isGroupPr: (fromBody?.isGroupPr ?? false) || fromTitle.isGroupPr || fromBranch.isGroupPr,
    groupName: fromTitle.groupName ?? fromBranch.groupName,
    updateType: [ fromBody?.updateType, fromTitle.updateType, fromBranch.updateType ]
      .find((type): type is UpdateType => type !== undefined && type !== 'unknown') ?? 'unknown',
    source,
    disagreements,
  };
}
