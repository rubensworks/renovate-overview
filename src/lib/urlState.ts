import type { GroupMode, GroupSortKey, IFilters, SortKey } from './selectors';
import {
  DEFAULT_GROUP_SORT,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  GROUP_LABELS,
  GROUP_SORT_LABELS,
  SORT_LABELS,
} from './selectors';

/**
 * Everything about how the list is shown, which is exactly what a shared link has to carry.
 */
export interface IViewState {
  group: GroupMode;
  sort: SortKey;
  groupSort: GroupSortKey;
  filters: IFilters;
  /**
   * The keys of the groups the user has collapsed.
   */
  collapsed: string[];
}

export const DEFAULT_VIEW: IViewState = {
  group: 'none',
  sort: DEFAULT_SORT,
  groupSort: DEFAULT_GROUP_SORT,
  filters: EMPTY_FILTERS,
  collapsed: [],
};

// The whole view lives in the fragment, so it never reaches a server, not even in a request line.
function parameters(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
}

function readEnum<TKey extends string>(
  value: string | null,
  labels: Record<TKey, string>,
  fallback: TKey,
): TKey {
  return value !== null && value in labels ? <TKey> value : fallback;
}

/**
 * Reads the view out of a URL fragment, falling back to the defaults for anything unrecognised.
 * @param hash A URL fragment, with or without its leading hash.
 */
export function readViewState(hash: string): IViewState {
  const parsed = parameters(hash);
  const collapsed = parsed.get('c') ?? '';
  return {
    group: readEnum(parsed.get('g'), GROUP_LABELS, DEFAULT_VIEW.group),
    sort: readEnum(parsed.get('s'), SORT_LABELS, DEFAULT_SORT),
    groupSort: readEnum(parsed.get('gs'), GROUP_SORT_LABELS, DEFAULT_GROUP_SORT),
    filters: {
      query: parsed.get('q') ?? '',
      onlyFailing: parsed.get('failing') === '1',
      onlyPassing: parsed.get('passing') === '1',
      onlyConflicting: parsed.get('conflicting') === '1',
      onlyMergeable: parsed.get('mergeable') === '1',
      hideDrafts: parsed.get('nodrafts') === '1',
      onlyMergeableByMe: parsed.get('mine') === '1',
      owner: parsed.get('owner') ?? '',
      updateType: parsed.get('type') ?? '',
      manager: parsed.get('manager') ?? '',
      depType: parsed.get('deptype') ?? '',
    },
    collapsed: collapsed.length === 0 ? [] : collapsed.split(','),
  };
}

/**
 * Serialises the view into a URL fragment, omitting everything that is at its default.
 * @param view The current view.
 */
export function toHash(view: IViewState): string {
  const parsed = new URLSearchParams();
  const { filters } = view;
  if (view.group !== DEFAULT_VIEW.group) {
    parsed.set('g', view.group);
  }
  if (view.sort !== DEFAULT_SORT) {
    parsed.set('s', view.sort);
  }
  if (view.groupSort !== DEFAULT_GROUP_SORT) {
    parsed.set('gs', view.groupSort);
  }
  if (filters.query.length > 0) {
    parsed.set('q', filters.query);
  }
  for (const [ name, value ] of <[string, boolean][]>[
    [ 'failing', filters.onlyFailing ],
    [ 'passing', filters.onlyPassing ],
    [ 'conflicting', filters.onlyConflicting ],
    [ 'mergeable', filters.onlyMergeable ],
    [ 'nodrafts', filters.hideDrafts ],
    [ 'mine', filters.onlyMergeableByMe ],
  ]) {
    if (value) {
      parsed.set(name, '1');
    }
  }
  for (const [ name, value ] of <[string, string][]>[
    [ 'owner', filters.owner ],
    [ 'type', filters.updateType ],
    [ 'manager', filters.manager ],
    [ 'deptype', filters.depType ],
  ]) {
    if (value.length > 0) {
      parsed.set(name, value);
    }
  }
  if (view.collapsed.length > 0) {
    parsed.set('c', view.collapsed.join(','));
  }
  const serialized = parsed.toString();
  return serialized.length === 0 ? '' : `#${serialized}`;
}

/**
 * Writes the view into the address bar without adding a history entry.
 *
 * Replacing rather than pushing keeps the back button meaning "leave this page" instead of
 * "undo the last checkbox".
 * @param view The current view.
 */
export function writeViewState(view: IViewState): void {
  const target = `${location.pathname}${location.search}${toHash(view)}`;
  if (target !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(null, '', target);
  }
}
