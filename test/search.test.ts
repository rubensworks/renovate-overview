import { describe, expect, it } from 'vitest';
import {
  authorsFor,
  buildSearchQuery,
  checkRunState,
  describeScope,
  mergePrs,
  normalizePage,
  normalizePr,
  planSearches,
  splitScope,
  statusContextState,
} from '../src/lib/search';
import type { IGraphqlRateLimit, IRenovatePr } from '../src/lib/types';
import { SETTINGS, node, page, pr } from './fixtures';

describe('authorsFor', () => {
  it('defaults to the three Renovate logins', () => {
    expect(authorsFor(SETTINGS)).toEqual([ 'renovate[bot]', 'renovate-bot', 'renovate' ]);
  });

  it('appends the configured extra logins', () => {
    expect(authorsFor({ ...SETTINGS, extraAuthors: [ 'my-bot' ]})).toContain('my-bot');
  });

  it('adds Dependabot only when asked', () => {
    expect(authorsFor(SETTINGS)).not.toContain('dependabot[bot]');
    expect(authorsFor({ ...SETTINGS, includeDependabot: true })).toContain('dependabot[bot]');
  });

  it('never queries the same login twice, whatever its casing', () => {
    expect(authorsFor({ ...SETTINGS, extraAuthors: [ 'Renovate-Bot', 'my-bot' ]}))
      .toEqual([ 'renovate[bot]', 'renovate-bot', 'renovate', 'my-bot' ]);
  });
});

describe('planSearches', () => {
  it('puts everything without its own token into one search', () => {
    expect(planSearches('rubensworks', [ 'comunica', 'solid' ], []))
      .toEqual([{ tokenOwner: undefined, owners: [ 'rubensworks', 'comunica', 'solid' ]}]);
  });

  it('gives an organisation with its own token a search of its own', () => {
    expect(planSearches('rubensworks', [ 'comunica', 'solid' ], [{ owner: 'Comunica', token: 'x' }]))
      .toEqual([
        { tokenOwner: undefined, owners: [ 'rubensworks', 'solid' ]},
        { tokenOwner: 'Comunica', owners: [ 'comunica' ]},
      ]);
  });

  it('never searches the same owner twice', () => {
    expect(planSearches('rubensworks', [ 'RubensWorks', 'comunica', 'Comunica' ], []))
      .toEqual([{ tokenOwner: undefined, owners: [ 'rubensworks', 'comunica' ]}]);
  });

  it('always produces at least the viewer', () => {
    expect(planSearches('rubensworks', [], []))
      .toEqual([{ tokenOwner: undefined, owners: [ 'rubensworks' ]}]);
  });
});

describe('splitScope', () => {
  it('turns one search over many owners into one search each, keeping the token', () => {
    expect(splitScope({ tokenOwner: 'org', owners: [ 'a', 'b' ]})).toEqual([
      { tokenOwner: 'org', owners: [ 'a' ]},
      { tokenOwner: 'org', owners: [ 'b' ]},
    ]);
  });
});

describe('describeScope', () => {
  it('names the owners it covers', () => {
    expect(describeScope({ tokenOwner: undefined, owners: [ 'a', 'b' ]})).toBe('a, b');
  });
});

describe('buildSearchQuery', () => {
  it('scopes to the viewer and spells the hosted app the way search does', () => {
    expect(buildSearchQuery({ tokenOwner: undefined, owners: [ 'rubensworks' ]}, [ 'renovate[bot]' ]))
      .toBe('is:open is:pr archived:false author:app/renovate user:rubensworks');
  });

  it('uses org: for every owner after the first, and for an organisation token search', () => {
    expect(buildSearchQuery({ tokenOwner: undefined, owners: [ 'me', 'comunica' ]}, [ 'renovate' ]))
      .toBe('is:open is:pr archived:false author:renovate user:me org:comunica');
    expect(buildSearchQuery({ tokenOwner: 'comunica', owners: [ 'comunica' ]}, [ 'renovate' ]))
      .toBe('is:open is:pr archived:false author:renovate org:comunica');
  });

  it('spells Dependabot as an app too', () => {
    expect(buildSearchQuery({ tokenOwner: undefined, owners: [ 'me' ]}, [ 'dependabot[bot]' ]))
      .toContain('author:app/dependabot');
  });

  it('refuses to search all of GitHub', () => {
    expect(() => buildSearchQuery({ tokenOwner: undefined, owners: []}, [ 'renovate' ]))
      .toThrow('at least one user or org');
    expect(() => buildSearchQuery({ tokenOwner: undefined, owners: [ '  ' ]}, [ 'renovate' ]))
      .toThrow('at least one user or org');
  });

  it('refuses to search every pull request', () => {
    expect(() => buildSearchQuery({ tokenOwner: undefined, owners: [ 'me' ]}, []))
      .toThrow('at least one author');
  });
});

const ABSENT: string | null | undefined = undefined;
const ABSENT_QUOTA: IGraphqlRateLimit | undefined = undefined;

describe('checkRunState', () => {
  it('calls anything not finished pending', () => {
    expect(checkRunState('QUEUED', null)).toBe('pending');
    expect(checkRunState('IN_PROGRESS', null)).toBe('pending');
    expect(checkRunState(ABSENT, ABSENT)).toBe('pending');
  });

  it('maps the finished conclusions', () => {
    expect(checkRunState('COMPLETED', 'SUCCESS')).toBe('success');
    expect(checkRunState('COMPLETED', 'FAILURE')).toBe('failure');
    expect(checkRunState('COMPLETED', 'TIMED_OUT')).toBe('failure');
    expect(checkRunState('COMPLETED', 'STARTUP_FAILURE')).toBe('failure');
    expect(checkRunState('COMPLETED', 'ACTION_REQUIRED')).toBe('error');
  });

  it('treats a cancelled or skipped check as saying nothing, rather than as a failure', () => {
    expect(checkRunState('COMPLETED', 'CANCELLED')).toBe('none');
    expect(checkRunState('COMPLETED', 'SKIPPED')).toBe('none');
    expect(checkRunState('COMPLETED', 'NEUTRAL')).toBe('none');
  });
});

describe('statusContextState', () => {
  it('maps every state a commit status can be in', () => {
    expect(statusContextState('SUCCESS')).toBe('success');
    expect(statusContextState('FAILURE')).toBe('failure');
    expect(statusContextState('ERROR')).toBe('error');
    expect(statusContextState('PENDING')).toBe('pending');
    expect(statusContextState('EXPECTED')).toBe('pending');
    expect(statusContextState(null)).toBe('none');
  });
});

describe('normalizePr', () => {
  it('turns a search node into a pull request', () => {
    expect(normalizePr(node())).toEqual(pr());
  });

  it('resolves what it updates straight away, from the title and branch', () => {
    const parsed = normalizePr(node());
    expect(parsed?.parse.source).toBe('title');
    expect(parsed?.parse.updates.map(update => update.groupKey)).toEqual([ 'lodash' ]);
    expect(parsed?.bodyLoaded).toBe(false);
  });

  it('drops a node that is not a pull request at all', () => {
    expect(normalizePr(null)).toBeUndefined();
    expect(normalizePr({})).toBeUndefined();
    expect(normalizePr(node({ id: undefined }))).toBeUndefined();
    expect(normalizePr(node({ number: undefined }))).toBeUndefined();
    expect(normalizePr(node({ repository: null }))).toBeUndefined();
  });

  it('reads a head commit with no checks as grey, not as a failure', () => {
    const parsed = normalizePr(node({
      commits: { nodes: [{ commit: { oid: 'abc', statusCheckRollup: null }}]},
    }));
    expect(parsed?.checkState).toBe('none');
    expect(parsed?.checks).toEqual([]);
  });

  it('trusts the rollup state over the contexts it was given, which are capped at 30', () => {
    const parsed = normalizePr(node({
      commits: {
        nodes: [{
          commit: {
            oid: 'abc',
            statusCheckRollup: {
              state: 'FAILURE',
              contexts: {
                totalCount: 40,
                nodes: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null }],
              },
            },
          },
        }],
      },
    }));
    expect(parsed?.checkState).toBe('failure');
    expect(parsed?.checks).toEqual([{ name: 'build', state: 'success', url: undefined }]);
  });

  it('reads commit statuses beside check runs, and skips anything it cannot name', () => {
    const parsed = normalizePr(node({
      commits: {
        nodes: [{
          commit: {
            oid: 'abc',
            statusCheckRollup: {
              state: 'PENDING',
              contexts: {
                totalCount: 3,
                nodes: [
                  { context: 'ci/travis', state: 'PENDING', targetUrl: 'https://travis' },
                  { context: 'ci/none', state: 'SUCCESS', targetUrl: null },
                  null,
                  {},
                ],
              },
            },
          },
        }],
      },
    }));
    expect(parsed?.checks).toEqual([
      { name: 'ci/travis', state: 'pending', url: 'https://travis' },
      { name: 'ci/none', state: 'success', url: undefined },
    ]);
    expect(parsed?.checkState).toBe('pending');
  });

  it('treats an uncomputed mergeability as unknown rather than as a conflict', () => {
    expect(normalizePr(node({ mergeable: 'UNKNOWN' }))?.mergeable).toBe('UNKNOWN');
    expect(normalizePr(node({ mergeable: null }))?.mergeable).toBe('UNKNOWN');
    expect(normalizePr(node({ mergeable: 'CONFLICTING' }))?.mergeable).toBe('CONFLICTING');
  });

  it('keeps only the review decisions it knows', () => {
    expect(normalizePr(node({ reviewDecision: 'APPROVED' }))?.reviewDecision).toBe('APPROVED');
    expect(normalizePr(node({ reviewDecision: 'CHANGES_REQUESTED' }))?.reviewDecision)
      .toBe('CHANGES_REQUESTED');
    expect(normalizePr(node({ reviewDecision: 'REVIEW_REQUIRED' }))?.reviewDecision)
      .toBe('REVIEW_REQUIRED');
    expect(normalizePr(node({ reviewDecision: 'ODD' }))?.reviewDecision).toBeNull();
  });

  it('reads whether the viewer could merge it themselves', () => {
    for (const permission of [ 'ADMIN', 'MAINTAIN', 'WRITE' ]) {
      expect(normalizePr(node({
        repository: { nameWithOwner: 'a/b', viewerPermission: permission },
      }))?.viewerCanMerge).toBe(true);
    }
    for (const permission of [ 'TRIAGE', 'READ', null ]) {
      expect(normalizePr(node({
        repository: { nameWithOwner: 'a/b', viewerPermission: permission },
      }))?.viewerCanMerge).toBe(false);
    }
  });

  it('survives a node with almost every optional field missing', () => {
    const parsed = normalizePr({ id: 'x', number: 1, repository: { nameWithOwner: 'a/b' }});
    expect(parsed).toEqual({
      id: 'x',
      repo: 'a/b',
      owner: 'a',
      number: 1,
      title: '',
      url: '',
      branch: '',
      baseBranch: '',
      author: '',
      createdAt: '',
      updatedAt: '',
      isDraft: false,
      isPrivate: false,
      labels: [],
      mergeable: 'UNKNOWN',
      reviewDecision: null,
      viewerCanMerge: false,
      checkState: 'none',
      checks: [],
      headSha: '',
      parse: {
        updates: [],
        isGroupPr: false,
        groupName: undefined,
        updateType: 'unknown',
        source: 'unknown',
        disagreements: [],
      },
      bodyLoaded: false,
    });
  });

  it('falls back to the created time when there is no update time', () => {
    expect(normalizePr(node({ updatedAt: undefined }))?.updatedAt).toBe('2026-08-01T10:00:00Z');
  });

  it('falls back to the head ref oid when the commit carries none', () => {
    expect(normalizePr(node({ commits: null }))?.headSha).toBe('deadbeef');
  });

  it('reads the owner out of the full name when the repository does not name one', () => {
    expect(normalizePr(node({ repository: { nameWithOwner: 'solid/spec' }}))?.owner).toBe('solid');
    expect(normalizePr({ id: 'x', number: 1, repository: { nameWithOwner: '' }})?.owner).toBe('');
    expect(normalizePr({ id: 'x', number: 1, repository: { nameWithOwner: 'noslash' }})?.owner).toBe('');
  });

  it('drops labels that have no name', () => {
    expect(normalizePr(node({ labels: { nodes: [{ name: 'a' }, null, {}]}}))?.labels).toEqual([ 'a' ]);
    expect(normalizePr(node({ labels: null }))?.labels).toEqual([]);
  });
});

describe('normalizePage', () => {
  it('normalises every node it recognises', () => {
    expect(normalizePage(page([ node(), null, {}]))).toEqual([ pr() ]);
  });

  it('copes with a page that carries no search block at all', () => {
    expect(normalizePage({ rateLimit: ABSENT_QUOTA })).toEqual([]);
    expect(normalizePage({ rateLimit: ABSENT_QUOTA, search: { nodes: null }})).toEqual([]);
  });
});

describe('mergePrs', () => {
  it('deduplicates by id, keeping the copy the search index updated most recently', () => {
    const older: IRenovatePr = pr({ updatedAt: '2026-08-01T00:00:00Z', title: 'old' });
    const newer: IRenovatePr = pr({ updatedAt: '2026-08-09T00:00:00Z', title: 'new' });
    expect(mergePrs([[ older ], [ newer ]])).toEqual([ newer ]);
    expect(mergePrs([[ newer ], [ older ]])).toEqual([ newer ]);
  });

  it('keeps pull requests from different repositories side by side', () => {
    const other = pr({ id: 'PR_2', repo: 'comunica/comunica' });
    expect(mergePrs([[ pr() ], [ other ]])).toHaveLength(2);
  });

  it('copes with nothing at all', () => {
    expect(mergePrs([])).toEqual([]);
  });
});
