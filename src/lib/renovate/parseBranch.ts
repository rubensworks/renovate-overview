import type { IDependencyUpdate, IParseResult, UpdateType } from '../types';
import { captured } from './capture';
import { normalizeKey } from './key';

/**
 * Branch prefixes Renovate puts an update type behind.
 */
const TYPE_PREFIXES: Record<string, UpdateType> = {
  major: 'major',
  minor: 'minor',
  patch: 'patch',
  digest: 'digest',
  pin: 'pin',
  rollback: 'rollback',
  replacement: 'replacement',
};

/**
 * Dependabot names its manager in the branch, which Renovate does not.
 */
const DEPENDABOT_MANAGERS: Record<string, string> = {
  npm_and_yarn: 'npm',
  github_actions: 'github-actions',
  docker: 'docker',
  gomod: 'gomod',
  cargo: 'cargo',
  bundler: 'bundler',
  composer: 'composer',
  maven: 'maven',
  gradle: 'gradle',
  nuget: 'nuget',
  pip: 'pip',
};

const LOCK_FILE_MAINTENANCE = 'Lock file maintenance';

function empty(): IParseResult {
  return { updates: [], isGroupPr: false, groupName: undefined, updateType: 'unknown', newVersion: undefined };
}

function update(depName: string, fields: Partial<IDependencyUpdate> = {}): IDependencyUpdate {
  return {
    depName,
    groupKey: normalizeKey(depName),
    updateType: 'unknown',
    source: 'branch',
    ...fields,
  };
}

// A trailing `-4.x`, `-20.11.5` or `-4` is the version; anything else is part of the name.
function splitVersion(slug: string): { name: string; newVersion: string | undefined } {
  const match = /^(.+)-(\d[\w.]*)$/u.exec(slug);
  if (match === null) {
    return { name: slug, newVersion: undefined };
  }
  return { name: captured(match, 1), newVersion: captured(match, 2) };
}

function fromSlug(slug: string): IParseResult {
  let rest = slug;
  let updateType: UpdateType = 'unknown';

  const prefix = /^([a-z]+)-/u.exec(rest);
  if (prefix !== null) {
    const prefixType = TYPE_PREFIXES[captured(prefix, 1)];
    if (prefixType !== undefined) {
      updateType = prefixType;
      rest = rest.slice(captured(prefix, 0).length);
    }
  }

  // A group whose members the branch cannot name: `all-minor-patch`, `all-non-major`, and the
  // bare `dependencies` that `pin-dependencies` leaves behind.
  if (rest === 'dependencies' || rest.startsWith('all-')) {
    return { updates: [], isGroupPr: true, groupName: rest, updateType, newVersion: undefined };
  }

  const { name, newVersion } = splitVersion(rest);
  if (name.length === 0) {
    return empty();
  }
  return {
    updates: [ update(name, { newVersion, updateType }) ],
    // A monorepo branch does name something usable, so it yields both a group and a key.
    isGroupPr: name.endsWith('-monorepo'),
    groupName: name.endsWith('-monorepo') ? name : undefined,
    updateType,
    newVersion,
  };
}

/**
 * Reads a bot branch name.
 *
 * Branch names carry less than titles, but they carry it more reliably: `semanticCommits` and
 * `commitMessagePrefix` rewrite titles and leave branches alone. That makes this both the last
 * fallback and the cross-check when a title parse looks odd.
 * @param raw A pull request head branch name.
 */
export function parseBranch(raw: string): IParseResult {
  const branch = raw.trim();
  if (branch.length === 0) {
    return empty();
  }

  const dependabot = /^dependabot\/([^/]+)\/(.+)$/u.exec(branch);
  if (dependabot !== null) {
    const { name, newVersion } = splitVersion(captured(dependabot, 2));
    return {
      updates: [ update(name, { newVersion, manager: DEPENDABOT_MANAGERS[captured(dependabot, 1)] }) ],
      isGroupPr: false,
      groupName: undefined,
      updateType: 'unknown',
      newVersion,
    };
  }

  // `branchPrefix` is configurable, so the marker is looked for anywhere on a path boundary
  // rather than only at the start.
  const renovate = /(?:^|\/)renovate\/(.+)$/u.exec(branch);
  if (renovate === null) {
    return empty();
  }
  const slug = captured(renovate, 1);

  if (slug === 'lock-file-maintenance') {
    return {
      updates: [ update(LOCK_FILE_MAINTENANCE, { updateType: 'lockFileMaintenance' }) ],
      isGroupPr: false,
      groupName: undefined,
      updateType: 'lockFileMaintenance',
      newVersion: undefined,
    };
  }

  return fromSlug(slug);
}
