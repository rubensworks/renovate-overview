import type { IDependencyUpdate, IParseResult, UpdateType } from '../types';
import { normalizeKey } from './key';

/**
 * Header names, lowercased, that hold each piece. `prBodyColumns` is configurable, so columns are
 * found by name and never by position — the same table can arrive with its columns in any order,
 * with some missing, and with extras that mean nothing here.
 */
const PACKAGE_HEADERS = [ 'package', 'dependency', 'depname' ];
const TYPE_HEADERS = [ 'type', 'deptype' ];
const UPDATE_HEADERS = [ 'update', 'updatetype' ];
const CHANGE_HEADERS = [ 'change' ];
const CURRENT_HEADERS = [ 'current value', 'current version', 'currentvalue' ];
const NEW_HEADERS = [ 'new value', 'new version', 'newvalue' ];
const MANAGER_HEADERS = [ 'manager', 'package manager' ];

const UPDATE_TYPES: Record<string, UpdateType> = {
  major: 'major',
  minor: 'minor',
  patch: 'patch',
  pin: 'pin',
  digest: 'digest',
  rollback: 'rollback',
  replacement: 'replacement',
  lockfilemaintenance: 'lockFileMaintenance',
};

function empty(): IParseResult {
  return { updates: [], isGroupPr: false, groupName: undefined, updateType: 'unknown', newVersion: undefined };
}

// A cell may be `[name](url)`, `` `1.2.3` ``, or `[name](url) ([source](url))`.
function plainText(cell: string): string {
  let text = cell.replaceAll(/\[([^\]]*)\]\([^)]*\)/gu, '$1').replaceAll('`', '').trim();
  // Whatever is left in trailing parentheses is a link's leftovers, not part of the name.
  while (/\([^()]*\)$/u.test(text)) {
    text = text.replace(/\s*\([^()]*\)$/u, '').trim();
  }
  return text;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|');
}

function isSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*$/u.test(line) && line.includes('-');
}

function indexOfHeader(headers: string[], names: string[]): number {
  return headers.findIndex(header => names.includes(header));
}

function at(row: string[], index: number): string | undefined {
  if (index === -1) {
    return undefined;
  }
  const value = plainText(row[index] ?? '');
  return value.length === 0 ? undefined : value;
}

// The Change column reads `` `1.53.0` -> `1.54.0` ``, sometimes wrapped in a diff link.
function splitChange(change: string | undefined): { current?: string; next?: string } {
  if (change === undefined) {
    return {};
  }
  const parts = change.split(/\s*->\s*/u);
  if (parts.length < 2) {
    return {};
  }
  return { current: parts[0]?.trim(), next: parts[1]?.trim() };
}

/**
 * Reads the dependency table out of a Renovate pull request body.
 *
 * This is the authoritative source: it names every package of a group pull request, which no
 * title can, and it states the update type and both versions outright rather than implying them.
 * It is also the expensive one — bodies carry entire release-note sections — so it is only ever
 * consulted for bodies that have actually been fetched.
 * @param raw A pull request body.
 */
export function parseBody(raw: string): IParseResult {
  // Renovate's own markers, which would otherwise be read as table content.
  const body = raw.replaceAll(/<!--[\s\S]*?-->/gu, '');
  const lines = body.split('\n');

  for (const [ index, line ] of lines.entries()) {
    const separator = lines[index + 1];
    if (separator === undefined || !line.trim().startsWith('|') || !isSeparator(separator)) {
      continue;
    }
    const headers = cells(line).map(header => header.trim().toLowerCase());
    const packageAt = indexOfHeader(headers, PACKAGE_HEADERS);
    // A table without a package column is a release note's own table, not the dependency table.
    if (packageAt === -1) {
      continue;
    }

    const typeAt = indexOfHeader(headers, TYPE_HEADERS);
    const updateAt = indexOfHeader(headers, UPDATE_HEADERS);
    const changeAt = indexOfHeader(headers, CHANGE_HEADERS);
    const currentAt = indexOfHeader(headers, CURRENT_HEADERS);
    const newAt = indexOfHeader(headers, NEW_HEADERS);
    const managerAt = indexOfHeader(headers, MANAGER_HEADERS);

    const updates: IDependencyUpdate[] = [];
    for (const rowLine of lines.slice(index + 2)) {
      if (!rowLine.trim().startsWith('|')) {
        break;
      }
      const values = cells(rowLine);
      const depName = at(values, packageAt);
      // A row whose package cell is empty describes nothing; there is no group to put it in.
      if (depName === undefined) {
        continue;
      }
      const change = splitChange(at(values, changeAt));
      updates.push({
        depName,
        groupKey: normalizeKey(depName),
        currentVersion: at(values, currentAt) ?? change.current,
        newVersion: at(values, newAt) ?? change.next,
        updateType: UPDATE_TYPES[(at(values, updateAt) ?? '').toLowerCase()] ?? 'unknown',
        depType: at(values, typeAt),
        manager: at(values, managerAt),
        source: 'body',
      });
    }

    // A pull request-level type and version only mean anything when the table describes one
    // package; for a group they belong to the individual rows.
    const only = updates.length === 1 ? updates[0] : undefined;
    return {
      updates,
      // One row is one update; several in one pull request is exactly what a group is.
      isGroupPr: updates.length > 1,
      groupName: undefined,
      updateType: only === undefined ? 'unknown' : only.updateType,
      newVersion: only === undefined ? undefined : only.newVersion,
    };
  }

  return empty();
}
