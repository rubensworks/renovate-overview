import type { IDependencyUpdate, IParseResult, UpdateType } from '../types';
import { captured } from './capture';
import { normalizeKey } from './key';

/**
 * Update types Renovate spells out in a trailing parenthesis. Anything else in that position is a
 * base branch — `(master)`, `(main)`, `(release/1.x)` — and says nothing about the update.
 */
const SUFFIX_UPDATE_TYPES: Record<string, UpdateType> = {
  major: 'major',
  minor: 'minor',
  patch: 'patch',
  digest: 'digest',
  pin: 'pin',
  rollback: 'rollback',
  replacement: 'replacement',
};

/**
 * Words that introduce the dependency name, and the manager each implies. Longest first, so
 * `rust crate` is tried before anything that starts with `rust`.
 */
const LEADING_KINDS: [string, string | undefined][] = [
  [ 'helm release', 'helm' ],
  [ 'helm chart', 'helm' ],
  [ 'rust crate', 'cargo' ],
  [ 'github action', 'github-actions' ],
  [ 'docker tag', 'docker' ],
  [ 'dependency', undefined ],
  [ 'module', 'gomod' ],
];

/**
 * Words that follow the dependency name, with what each implies.
 */
const TRAILING_KINDS: [string, { manager?: string; updateType?: UpdateType; group?: boolean }][] = [
  [ 'docker tag', { manager: 'docker' }],
  [ 'monorepo', { group: true }],
  [ 'action', { manager: 'github-actions' }],
  [ 'digest', { updateType: 'digest' }],
  [ 'orb', { manager: 'circleci' }],
  [ 'image', { manager: 'docker' }],
];

const LOCK_FILE_MAINTENANCE = 'Lock file maintenance';

function empty(): IParseResult {
  return { updates: [], isGroupPr: false, groupName: undefined, updateType: 'unknown', newVersion: undefined };
}

function update(
  depName: string,
  fields: Partial<IDependencyUpdate> = {},
): IDependencyUpdate {
  return {
    depName,
    groupKey: normalizeKey(depName),
    updateType: 'unknown',
    source: 'title',
    ...fields,
  };
}

// Renovate writes `to v4.17.21`, but a constraint like `~5.4.0` or a digest like `a1b2c3d` has no
// `v` to drop, so only a `v` that actually precedes a number is one.
function cleanVersion(raw: string): string {
  const trimmed = raw.trim();
  return /^v\d/u.test(trimmed) ? trimmed.slice(1) : trimmed;
}

function stripLeadingKind(name: string): { name: string; manager: string | undefined; matched: boolean } {
  const lower = name.toLowerCase();
  for (const [ word, manager ] of LEADING_KINDS) {
    if (lower.startsWith(`${word} `)) {
      return { name: name.slice(word.length + 1).trim(), manager, matched: true };
    }
  }
  return { name, manager: undefined, matched: false };
}

function stripTrailingKind(name: string): {
  name: string;
  manager: string | undefined;
  updateType: UpdateType | undefined;
  group: boolean;
} {
  const lower = name.toLowerCase();
  for (const [ word, implied ] of TRAILING_KINDS) {
    if (lower.endsWith(` ${word}`)) {
      return {
        name: name.slice(0, -word.length - 1).trim(),
        manager: implied.manager,
        updateType: implied.updateType,
        group: implied.group === true,
      };
    }
  }
  return { name, manager: undefined, updateType: undefined, group: false };
}

/**
 * Reads a Renovate pull request title.
 *
 * Titles are templated, but the template is configurable — `semanticCommits`,
 * `commitMessagePrefix`, `separateMajorMinor` and the group presets all change it — so this peels
 * the decorations off in a fixed order and then reads what is left. Anything it does not
 * recognise comes back empty rather than guessed at.
 * @param raw A pull request title.
 */
export function parseTitle(raw: string): IParseResult {
  let title = raw.trim();
  if (title.length === 0) {
    return empty();
  }

  // Decorations users and bots bolt on: `[SECURITY]`, `[skip ci]`, ` - autoclosed`.
  title = title.replace(/\s+-\s+autoclosed$/iu, '');
  while (/\s*\[[^\]]*\]$/u.test(title)) {
    title = title.replace(/\s*\[[^\]]*\]$/u, '');
  }

  // A semantic-commit prefix: `chore(deps):`, `fix(deps):`, `chore(deps)!:`.
  title = title.replace(/^[a-z]+(\([^)]*\))?!?:\s*/iu, '');

  // A trailing parenthesis is either an update type or the base branch.
  let updateType: UpdateType = 'unknown';
  const suffix = /\s*\(([^()]*)\)$/u.exec(title);
  if (suffix !== null) {
    const found = SUFFIX_UPDATE_TYPES[captured(suffix, 1).toLowerCase()];
    if (found !== undefined) {
      updateType = found;
    }
    title = title.slice(0, suffix.index).trim();
  }

  if (title.toLowerCase() === 'lock file maintenance') {
    return {
      updates: [ update(LOCK_FILE_MAINTENANCE, { updateType: 'lockFileMaintenance' }) ],
      isGroupPr: false,
      groupName: undefined,
      updateType: 'lockFileMaintenance',
      newVersion: undefined,
    };
  }

  // Only Renovate's own verbs are recognised. Anything else is somebody's own pull request that
  // happens to be in the list, and guessing at it would put it in a wrong group.
  const verb = /^(update|pin)\s+/iu.exec(title);
  if (verb === null) {
    return empty();
  }
  if (captured(verb, 1).toLowerCase() === 'pin') {
    updateType = 'pin';
  }
  let rest = title.slice(verb[0].length).trim();

  // `all non-major dependencies`, `all patch dependencies`, and the bare `dependencies` that
  // `pin dependencies` leaves behind.
  if (/^all\b.*\bdependencies$/iu.test(rest) || rest.toLowerCase() === 'dependencies') {
    return { updates: [], isGroupPr: true, groupName: rest, updateType, newVersion: undefined };
  }

  // Everything after the last ` to ` is the version, so a name containing ` to ` cannot confuse it.
  let newVersion: string | undefined;
  const separator = rest.toLowerCase().lastIndexOf(' to ');
  if (separator !== -1) {
    newVersion = cleanVersion(rest.slice(separator + 4));
    rest = rest.slice(0, separator).trim();
  }

  const trailing = stripTrailingKind(rest);
  const leading = stripLeadingKind(trailing.name);
  const depName = leading.name;
  const manager = leading.manager ?? trailing.manager;
  if (trailing.updateType !== undefined && updateType === 'unknown') {
    updateType = trailing.updateType;
  }

  // A monorepo group, or a title that named something without ever saying what kind of thing it
  // is: the members are unknowable until the body is loaded, so the group is recorded and left
  // empty rather than inventing a dependency out of the group's name.
  if (trailing.group || (separator === -1 && !leading.matched)) {
    return { updates: [], isGroupPr: true, groupName: rest, updateType, newVersion };
  }

  return {
    updates: [ update(depName, { newVersion, updateType, manager }) ],
    isGroupPr: false,
    groupName: undefined,
    updateType,
    newVersion,
  };
}
