import { normalizeKey } from './renovate/key';
import type { CheckState, IRenovatePr, UpdateType } from './types';

export type GroupMode = 'dependency' | 'none' | 'owner' | 'repo' | 'update-type';

export type SortKey = 'created' | 'dependency' | 'number' | 'repo' | 'status' | 'update-type' | 'updated';

export type GroupSortKey = 'name' | 'size' | 'status';

export const GROUP_LABELS: Record<GroupMode, string> = {
  none: 'None (flat)',
  repo: 'By repository',
  dependency: 'By dependency',
  'update-type': 'By update type',
  owner: 'By owner',
};

export const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Last updated',
  created: 'Created',
  repo: 'Repository',
  dependency: 'Dependency',
  status: 'Failing first',
  'update-type': 'Update type',
  number: 'PR number',
};

export const GROUP_SORT_LABELS: Record<GroupSortKey, string> = {
  size: 'Size',
  name: 'Name',
  status: 'Worst status',
};

export const DEFAULT_SORT: SortKey = 'updated';
export const DEFAULT_GROUP_SORT: GroupSortKey = 'size';

/**
 * Worst first. This is the order the status sort uses, and the order a group's roll-up is reduced
 * in, so a group with one failing pull request reads as failing.
 */
export const CHECK_STATE_SEVERITY: Record<CheckState, number> = {
  failure: 0,
  error: 1,
  pending: 2,
  success: 3,
  none: 4,
};

/**
 * Most disruptive first, which is the order somebody working through a backlog wants.
 */
const UPDATE_TYPE_ORDER: Record<UpdateType, number> = {
  major: 0,
  minor: 1,
  patch: 2,
  digest: 3,
  pin: 4,
  rollback: 5,
  replacement: 6,
  lockFileMaintenance: 7,
  unknown: 8,
};

export const UNRECOGNISED_KEY = '~unrecognised';
export const UNRECOGNISED_LABEL = 'Unrecognised';

export interface IFilters {
  query: string;
  onlyFailing: boolean;
  onlyPassing: boolean;
  onlyConflicting: boolean;
  onlyMergeable: boolean;
  hideDrafts: boolean;
  /**
   * Only pull requests the viewer's repository permission would let them merge.
   */
  onlyMergeableByMe: boolean;
  owner: string;
  updateType: string;
  manager: string;
  depType: string;
}

export const EMPTY_FILTERS: IFilters = {
  query: '',
  onlyFailing: false,
  onlyPassing: false,
  onlyConflicting: false,
  onlyMergeable: false,
  hideDrafts: false,
  onlyMergeableByMe: false,
  owner: '',
  updateType: '',
  manager: '',
  depType: '',
};

export interface IGroup {
  key: string;
  label: string;
  prs: IRenovatePr[];
  counts: Record<CheckState, number>;
  /**
   * The worst check state in the group, which is what its header is coloured by.
   */
  worst: CheckState;
}

/**
 * Rolls a set of pull requests up into a count per check state.
 * @param prs Some pull requests.
 */
export function countByState(prs: IRenovatePr[]): Record<CheckState, number> {
  const counts: Record<CheckState, number> = { success: 0, failure: 0, pending: 0, error: 0, none: 0 };
  for (const pr of prs) {
    counts[pr.checkState] += 1;
  }
  return counts;
}

/**
 * The worst check state present, or `none` when there is nothing to judge.
 * @param prs Some pull requests.
 */
export function worstState(prs: IRenovatePr[]): CheckState {
  let worst: CheckState = 'none';
  for (const pr of prs) {
    if (CHECK_STATE_SEVERITY[pr.checkState] < CHECK_STATE_SEVERITY[worst]) {
      worst = pr.checkState;
    }
  }
  return worst;
}

/**
 * The text a free-text query is matched against: repository, dependency, title and branch.
 * @param pr A pull request.
 */
export function searchableText(pr: IRenovatePr): string {
  return [
    pr.repo,
    pr.title,
    pr.branch,
    pr.parse.groupName ?? '',
    ...pr.parse.updates.map(update => update.depName),
  ].join(' ').toLowerCase();
}

/**
 * Whether a pull request survives the current filters.
 * @param pr A pull request.
 * @param filters The current filters.
 */
export function matchesFilters(pr: IRenovatePr, filters: IFilters): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query.length > 0 && !searchableText(pr).includes(query)) {
    return false;
  }
  // `error` is a kind of failing: a check that could not run is not a check that passed.
  if (filters.onlyFailing && pr.checkState !== 'failure' && pr.checkState !== 'error') {
    return false;
  }
  if (filters.onlyPassing && pr.checkState !== 'success') {
    return false;
  }
  if (filters.onlyConflicting && pr.mergeable !== 'CONFLICTING') {
    return false;
  }
  if (filters.onlyMergeable && pr.mergeable !== 'MERGEABLE') {
    return false;
  }
  if (filters.hideDrafts && pr.isDraft) {
    return false;
  }
  if (filters.onlyMergeableByMe && !pr.viewerCanMerge) {
    return false;
  }
  if (filters.owner.length > 0 && pr.owner.toLowerCase() !== filters.owner.toLowerCase()) {
    return false;
  }
  if (filters.updateType.length > 0 && !updateTypesOf(pr).includes(filters.updateType)) {
    return false;
  }
  if (filters.manager.length > 0 && !pr.parse.updates.some(update => update.manager === filters.manager)) {
    return false;
  }
  if (filters.depType.length > 0 && !pr.parse.updates.some(update => update.depType === filters.depType)) {
    return false;
  }
  return true;
}

// A group pull request has an update type per package, and the pull request itself may state one
// the packages do not.
function updateTypesOf(pr: IRenovatePr): string[] {
  const types = pr.parse.updates.map(update => update.updateType);
  return [ ...new Set([ ...types, pr.parse.updateType ]) ];
}

/**
 * Applies the filters.
 * @param prs Some pull requests.
 * @param filters The current filters.
 */
export function filterPrs(prs: IRenovatePr[], filters: IFilters): IRenovatePr[] {
  return prs.filter(pr => matchesFilters(pr, filters));
}

// The dependency a row is labelled by, which is the first one a group pull request carries.
function primaryDep(pr: IRenovatePr): string {
  return pr.parse.updates[0]?.depName ?? pr.parse.groupName ?? '';
}

function compareBy(key: SortKey, left: IRenovatePr, right: IRenovatePr): number {
  switch (key) {
    case 'created':
      return right.createdAt.localeCompare(left.createdAt);
    case 'repo':
      // Lowercased so that owners stay together rather than splitting on capitalisation.
      return left.repo.toLowerCase().localeCompare(right.repo.toLowerCase());
    case 'dependency':
      return primaryDep(left).toLowerCase().localeCompare(primaryDep(right).toLowerCase());
    case 'status':
      return CHECK_STATE_SEVERITY[left.checkState] - CHECK_STATE_SEVERITY[right.checkState];
    case 'update-type':
      return UPDATE_TYPE_ORDER[left.parse.updateType] - UPDATE_TYPE_ORDER[right.parse.updateType];
    case 'number':
      return left.number - right.number;
    case 'updated':
    default:
      return right.updatedAt.localeCompare(left.updatedAt);
  }
}

/**
 * Sorts pull requests, stably.
 *
 * Ties resolve to the update time and then to the URL, so two refreshes of the same data produce
 * the same order and rows do not shuffle under the pointer.
 * @param prs Some pull requests.
 * @param key What to sort on.
 */
export function sortPrs(prs: IRenovatePr[], key: SortKey): IRenovatePr[] {
  return [ ...prs ].sort((left, right) =>
    compareBy(key, left, right) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.url.localeCompare(right.url));
}

interface IBucket {
  key: string;
  label: string;
  prs: IRenovatePr[];
  seen: Set<string>;
}

// `none` is handled before this is reached, so every remaining mode produces at least one bucket.
function bucketsFor(pr: IRenovatePr, mode: Exclude<GroupMode, 'none'>): { key: string; label: string }[] {
  switch (mode) {
    case 'repo':
      return [{ key: pr.repo.toLowerCase(), label: pr.repo }];
    case 'owner':
      return [{ key: pr.owner.toLowerCase(), label: pr.owner }];
    case 'update-type':
      return [{ key: pr.parse.updateType, label: pr.parse.updateType }];
    case 'dependency': {
      // A group pull request belongs to every dependency it contains, so merging it does more
      // than any one group's header suggests — which is what the "+N more" badge is for.
      const keys = pr.parse.updates.map(update => ({ key: update.groupKey, label: update.depName }));
      if (keys.length > 0) {
        return keys;
      }
      // A group whose body has not been loaded names itself but not its members.
      if (pr.parse.groupName !== undefined) {
        return [{ key: normalizeKey(pr.parse.groupName), label: pr.parse.groupName }];
      }
      return [{ key: UNRECOGNISED_KEY, label: UNRECOGNISED_LABEL }];
    }
  }
}

/**
 * Groups pull requests.
 *
 * Grouping by dependency puts a group pull request in every group it touches. Within one group it
 * appears once however many of that group's packages it carries, so a group's count is a count of
 * pull requests rather than of rows.
 * @param prs Some pull requests, already sorted.
 * @param mode How to group them.
 */
export function groupPrs(prs: IRenovatePr[], mode: GroupMode): IGroup[] {
  if (mode === 'none') {
    return [];
  }
  const buckets = new Map<string, IBucket>();
  for (const pr of prs) {
    for (const { key, label } of bucketsFor(pr, mode)) {
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = { key, label, prs: [], seen: new Set() };
        buckets.set(key, bucket);
      }
      if (!bucket.seen.has(pr.id)) {
        bucket.seen.add(pr.id);
        bucket.prs.push(pr);
      }
    }
  }
  return [ ...buckets.values() ].map(bucket => ({
    key: bucket.key,
    label: bucket.label,
    prs: bucket.prs,
    counts: countByState(bucket.prs),
    worst: worstState(bucket.prs),
  }));
}

/**
 * Orders the groups themselves.
 *
 * The unrecognised group always sinks to the bottom: it is a to-do list for the parser, not a
 * dependency anybody is looking for.
 * @param groups Some groups.
 * @param key What to order them on.
 */
export function sortGroups(groups: IGroup[], key: GroupSortKey): IGroup[] {
  return [ ...groups ].sort((left, right) => {
    if ((left.key === UNRECOGNISED_KEY) !== (right.key === UNRECOGNISED_KEY)) {
      return left.key === UNRECOGNISED_KEY ? 1 : -1;
    }
    if (key === 'size' && left.prs.length !== right.prs.length) {
      return right.prs.length - left.prs.length;
    }
    if (key === 'status' && left.worst !== right.worst) {
      return CHECK_STATE_SEVERITY[left.worst] - CHECK_STATE_SEVERITY[right.worst];
    }
    return left.label.toLowerCase().localeCompare(right.label.toLowerCase());
  });
}

function distinct(values: (string | undefined)[]): string[] {
  return [ ...new Set(values.filter((value): value is string => value !== undefined && value.length > 0)) ].sort();
}

/**
 * The owners present, for the owner filter.
 * @param prs Some pull requests.
 */
export function ownersOf(prs: IRenovatePr[]): string[] {
  return distinct(prs.map(pr => pr.owner));
}

/**
 * The managers present, for the manager filter.
 * @param prs Some pull requests.
 */
export function managersOf(prs: IRenovatePr[]): string[] {
  return distinct(prs.flatMap(pr => pr.parse.updates.map(update => update.manager)));
}

/**
 * The dependency types present, for the dependency-type filter.
 * @param prs Some pull requests.
 */
export function depTypesOf(prs: IRenovatePr[]): string[] {
  return distinct(prs.flatMap(pr => pr.parse.updates.map(update => update.depType)));
}

/**
 * The update types present, for the update-type filter.
 * @param prs Some pull requests.
 */
export function updateTypesPresent(prs: IRenovatePr[]): string[] {
  return distinct(prs.flatMap(pr => updateTypesOf(pr)));
}

/**
 * The pull requests in a group whose checks are green and which nothing is blocking — the
 * selection "merge all green in this group" acts on.
 * @param prs Some pull requests.
 */
export function greenIn(prs: IRenovatePr[]): IRenovatePr[] {
  return prs.filter(pr =>
    pr.checkState === 'success' && !pr.isDraft && pr.mergeable !== 'CONFLICTING');
}
