import { resolveUpdates } from '../src/lib/renovate/resolve';
import type { IApiNode, ISearchPage } from '../src/lib/search';
import type { IRenovatePr, ISettings } from '../src/lib/types';

export const SETTINGS: ISettings = {
  orgs: [],
  extraAuthors: [],
  includeDependabot: false,
  writeActions: false,
  theme: 'auto',
};

/**
 * A search result node, in the shape the GraphQL query asks for.
 * @param overrides Fields to change.
 */
export function node(overrides: Record<string, unknown> = {}): IApiNode {
  return {
    id: 'PR_1',
    number: 42,
    title: 'Update dependency lodash to v4.17.21',
    url: 'https://github.com/rubensworks/jbr.js/pull/42',
    headRefName: 'renovate/lodash-4.x',
    baseRefName: 'master',
    headRefOid: 'deadbeef',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-10T10:00:00Z',
    isDraft: false,
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    author: { login: 'renovate[bot]' },
    labels: { nodes: [{ name: 'dependencies' }]},
    repository: {
      nameWithOwner: 'rubensworks/jbr.js',
      isPrivate: false,
      viewerPermission: 'ADMIN',
      owner: { login: 'rubensworks' },
    },
    commits: {
      nodes: [{
        commit: {
          oid: 'deadbeef',
          statusCheckRollup: {
            state: 'SUCCESS',
            contexts: {
              totalCount: 1,
              nodes: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci' }],
            },
          },
        },
      }],
    },
    ...overrides,
  };
}

/**
 * One page of search results.
 * @param nodes The result nodes.
 * @param overrides Fields to change on the page itself.
 * @param overrides.issueCount How many results GitHub claims to have.
 * @param overrides.hasNextPage Whether another page follows.
 * @param overrides.endCursor The cursor of the next page.
 */
export function page(
  nodes: (IApiNode | null)[] = [ node() ],
  overrides: { issueCount?: number; hasNextPage?: boolean; endCursor?: string | null } = {},
): ISearchPage {
  return {
    rateLimit: { limit: 5000, cost: 1, remaining: 4987, resetAt: '2026-08-17T18:00:00Z' },
    search: {
      issueCount: overrides.issueCount ?? nodes.length,
      pageInfo: {
        hasNextPage: overrides.hasNextPage ?? false,
        endCursor: overrides.endCursor === undefined ? 'CURSOR' : overrides.endCursor,
      },
      nodes,
    },
  };
}

/**
 * A normalised pull request, for tests about what happens after fetching.
 * @param overrides Fields to change.
 */
export function pr(overrides: Partial<IRenovatePr> = {}): IRenovatePr {
  const base: IRenovatePr = {
    id: 'PR_1',
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
