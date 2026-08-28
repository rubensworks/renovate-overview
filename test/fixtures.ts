import { resolveUpdates } from '../src/lib/renovate/resolve';
import type { IApiPullRequest, IApiSearchItem, ISearchResponse } from '../src/lib/search';
import type { IRenovatePr, ISettings } from '../src/lib/types';

export const SETTINGS: ISettings = {
  orgs: [],
  excludedRepos: [],
  extraAuthors: [],
  includeDependabot: false,
  writeActions: false,
  mergeMethod: 'squash',
  repoMergeMethods: {},
  theme: 'auto',
};

/**
 * One item of a `GET /search/issues` response.
 * @param overrides Fields to change.
 */
export function searchItem(overrides: Partial<IApiSearchItem> = {}): IApiSearchItem {
  return {
    number: 42,
    title: 'Update dependency lodash to v4.17.21',
    html_url: 'https://github.com/rubensworks/jbr.js/pull/42',
    state: 'open',
    draft: false,
    body: null,
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-10T10:00:00Z',
    user: { login: 'renovate[bot]' },
    labels: [{ name: 'dependencies' }],
    repository_url: 'https://api.github.com/repos/rubensworks/jbr.js',
    pull_request: { url: 'https://api.github.com/repos/rubensworks/jbr.js/pulls/42' },
    ...overrides,
  };
}

/**
 * A page of search results.
 * @param items The items on this page.
 * @param totalCount How many results GitHub claims to have, defaulting to the page size.
 */
export function searchPage(items: (IApiSearchItem | null)[] = [ searchItem() ], totalCount?: number): ISearchResponse {
  return { total_count: totalCount ?? items.length, incomplete_results: false, items };
}

/**
 * A `GET /repos/{owner}/{repo}/pulls/{number}` response.
 * @param overrides Fields to change.
 */
export function prDetail(overrides: Partial<IApiPullRequest> = {}): IApiPullRequest {
  return {
    number: 42,
    state: 'open',
    body: null,
    draft: false,
    mergeable: true,
    updated_at: '2026-08-10T10:00:00Z',
    head: { ref: 'renovate/lodash-4.x', sha: 'deadbeef' },
    base: { ref: 'master', repo: { private: false, permissions: { push: true }}},
    ...overrides,
  };
}

/**
 * A normalised pull request, for tests about what happens after fetching.
 * @param overrides Fields to change.
 */
export function pr(overrides: Partial<IRenovatePr> = {}): IRenovatePr {
  const base: IRenovatePr = {
    id: 'rubensworks/jbr.js#42',
    repo: 'rubensworks/jbr.js',
    owner: 'rubensworks',
    number: 42,
    title: 'Update dependency lodash to v4.17.21',
    url: 'https://github.com/rubensworks/jbr.js/pull/42',
    branch: 'renovate/lodash-4.x',
    baseBranch: 'master',
    author: 'renovate[bot]',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-10T10:00:00Z',
    isDraft: false,
    isPrivate: false,
    labels: [ 'dependencies' ],
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    viewerCanMerge: true,
    checkState: 'success',
    checks: [{ name: 'build', state: 'success', url: 'https://ci' }],
    headSha: 'deadbeef',
    detailLoaded: true,
    parse: {
      updates: [],
      isGroupPr: false,
      groupName: undefined,
      updateType: 'unknown',
      source: 'unknown',
      disagreements: [],
    },
    bodyLoaded: false,
  };
  const merged = { ...base, ...overrides };
  // The parse follows from the title and branch, so a fixture that changes either gets a parse to
  // match rather than the placeholder above — unless it states one of its own.
  return overrides.parse === undefined ? { ...merged, parse: resolveUpdates(merged) } : merged;
}
