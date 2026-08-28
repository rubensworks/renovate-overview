import { describe, expect, it } from 'vitest';
import { MAX_QUERY_LENGTH } from '../src/lib/exclusions';
import {
  applyChecks,
  applyDetail,
  authorsFor,
  buildSearchQuery,
  checkRunState,
  describeScope,
  mergePrs,
  normalizeSearchItem,
  planSearches,
  repoFromUrl,
  reviewDecisionFrom,
  splitScope,
  statusContextState,
  worstCheckState,
} from '../src/lib/search';
import type { ICombinedStatus } from '../src/lib/search';
import type { IRenovatePr } from '../src/lib/types';
import { SETTINGS, pr, prDetail, searchItem } from './fixtures';

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
  // Every one of these is an OR group even when it holds a single term, because
  // `advanced_search=true` combines repeated qualifiers with AND. `author:a author:b` asks for
  // pull requests written by two people at once, which is nothing; the same is true of
  // `user:x org:y`. Both cost this dashboard every one of its rows once, so both are pinned here.
  it('scopes to the viewer and spells the hosted app the way search does', () => {
    expect(buildSearchQuery({ tokenOwner: undefined, owners: [ 'rubensworks' ]}, [ 'renovate[bot]' ]))
      .toBe('is:open is:pr archived:false (author:app/renovate) (user:rubensworks)');
  });

  it('asks for either author rather than for both at once', () => {
    expect(buildSearchQuery(
      { tokenOwner: undefined, owners: [ 'me' ]},
      [ 'renovate[bot]', 'renovate-bot', 'renovate' ],
    )).toBe(
      'is:open is:pr archived:false ' +
      '(author:app/renovate OR author:renovate-bot OR author:renovate) (user:me)',
    );
  });

  it('asks for either owner rather than for both at once', () => {
    expect(buildSearchQuery({ tokenOwner: undefined, owners: [ 'me', 'comunica', 'solid' ]}, [ 'renovate' ]))
      .toBe('is:open is:pr archived:false (author:renovate) (user:me OR org:comunica OR org:solid)');
  });

  it('uses org: for a search running under an organisation token', () => {
    expect(buildSearchQuery({ tokenOwner: 'comunica', owners: [ 'comunica' ]}, [ 'renovate' ]))
      .toBe('is:open is:pr archived:false (author:renovate) (org:comunica)');
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

  it('leaves out an excluded repository of an owner it covers', () => {
    expect(buildSearchQuery(
      { tokenOwner: undefined, owners: [ 'me', 'comunica' ]},
      [ 'renovate' ],
      [ 'comunica/incremunica' ],
    )).toBe(
      'is:open is:pr archived:false (author:renovate) (user:me OR org:comunica) -repo:comunica/incremunica',
    );
  });

  it('says nothing about a repository this search could not have matched anyway', () => {
    expect(buildSearchQuery({ tokenOwner: undefined, owners: [ 'me' ]}, [ 'renovate' ], [ 'comunica/incremunica' ]))
      .toBe('is:open is:pr archived:false (author:renovate) (user:me)');
  });

  it('stops adding exclusions before the query grows past what GitHub accepts', () => {
    const excluded = Array.from({ length: 40 }, (_unused, index) => `comunica/repository-number-${index}`);
    const query = buildSearchQuery({ tokenOwner: undefined, owners: [ 'comunica' ]}, [ 'renovate' ], excluded);
    expect(query.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
    expect(query).toContain('-repo:comunica/repository-number-0');
    expect(query).not.toContain('-repo:comunica/repository-number-39');
  });
});

const ABSENT: string | null | undefined = undefined;
const NO_STATUS: ICombinedStatus | undefined = undefined;

describe('checkRunState', () => {
  it('calls anything not finished pending', () => {
    expect(checkRunState('queued', null)).toBe('pending');
    expect(checkRunState('in_progress', null)).toBe('pending');
    expect(checkRunState(ABSENT, ABSENT)).toBe('pending');
  });

  it('maps the finished conclusions, whatever their casing', () => {
    expect(checkRunState('completed', 'success')).toBe('success');
    expect(checkRunState('COMPLETED', 'SUCCESS')).toBe('success');
    expect(checkRunState('completed', 'failure')).toBe('failure');
    expect(checkRunState('completed', 'timed_out')).toBe('failure');
    expect(checkRunState('completed', 'startup_failure')).toBe('failure');
    expect(checkRunState('completed', 'action_required')).toBe('error');
  });

  it('says nothing about a finished check that reports no conclusion', () => {
    expect(checkRunState('completed', null)).toBe('none');
    expect(checkRunState('completed', ABSENT)).toBe('none');
  });

  it('treats a cancelled or skipped check as saying nothing, rather than as a failure', () => {
    expect(checkRunState('completed', 'cancelled')).toBe('none');
    expect(checkRunState('completed', 'skipped')).toBe('none');
    expect(checkRunState('completed', 'neutral')).toBe('none');
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

describe('worstCheckState', () => {
  it('is none when there is nothing to judge', () => {
    expect(worstCheckState([])).toBe('none');
  });

  it('lets the worst one speak for the commit', () => {
    expect(worstCheckState([
      { name: 'a', state: 'success', url: undefined },
      { name: 'b', state: 'failure', url: undefined },
    ])).toBe('failure');
    expect(worstCheckState([
      { name: 'a', state: 'success', url: undefined },
      { name: 'b', state: 'pending', url: undefined },
    ])).toBe('pending');
  });

  it('is none when every check is itself inconclusive', () => {
    expect(worstCheckState([{ name: 'a', state: 'none', url: undefined }])).toBe('none');
  });
});

describe('repoFromUrl', () => {
  it('reads the repository out of an API URL', () => {
    expect(repoFromUrl('https://api.github.com/repos/rubensworks/jbr.js')).toBe('rubensworks/jbr.js');
  });

  it('finds nothing in anything else', () => {
    expect(repoFromUrl('https://api.github.com/users/rubensworks')).toBeUndefined();
    expect(repoFromUrl(ABSENT)).toBeUndefined();
  });
});

describe('normalizeSearchItem', () => {
  it('turns a search result into a pull request', () => {
    expect(normalizeSearchItem(searchItem())).toEqual(pr({
      // The search says nothing about any of this; the detail fetch fills it in.
      branch: '',
      baseBranch: '',
      headSha: '',
      mergeable: 'UNKNOWN',
      checkState: 'none',
      checks: [],
      detailLoaded: false,
    }));
  });

  it('identifies a pull request by owner, repo and number', () => {
    expect(normalizeSearchItem(searchItem())?.id).toBe('rubensworks/jbr.js#42');
  });

  it('drops anything that is not a pull request', () => {
    expect(normalizeSearchItem(null)).toBeUndefined();
    expect(normalizeSearchItem({})).toBeUndefined();
    // An issue, which the same search endpoint also returns.
    expect(normalizeSearchItem(searchItem({ pull_request: undefined }))).toBeUndefined();
    expect(normalizeSearchItem(searchItem({ pull_request: null }))).toBeUndefined();
    expect(normalizeSearchItem(searchItem({ number: undefined }))).toBeUndefined();
    expect(normalizeSearchItem(searchItem({ repository_url: 'nonsense' }))).toBeUndefined();
  });

  it('parses the body the search already handed over, rather than fetching it again', () => {
    const body = [
      '| Package | Type | Update | Change |',
      '|---|---|---|---|',
      '| [eslint](u) | devDependencies | minor | [`8.56.0` -> `8.57.0`](d) |',
      '| [@types/node](u) | devDependencies | patch | [`20.11.4` -> `20.11.5`](d) |',
    ].join('\n');
    const parsed = normalizeSearchItem(searchItem({ title: 'Update all non-major dependencies', body }));
    expect(parsed?.bodyLoaded).toBe(true);
    expect(parsed?.parse.source).toBe('body');
    expect(parsed?.parse.updates.map(update => update.groupKey)).toEqual([ 'eslint', 'types-node' ]);
  });

  it('assumes the viewer could merge it until something says otherwise', () => {
    expect(normalizeSearchItem(searchItem())?.viewerCanMerge).toBe(true);
  });

  it('survives an item with almost every optional field missing', () => {
    const parsed = normalizeSearchItem({
      number: 1,
      repository_url: 'https://api.github.com/repos/a/b',
      pull_request: {},
    });
    expect(parsed?.repo).toBe('a/b');
    expect(parsed?.owner).toBe('a');
    expect(parsed?.title).toBe('');
    expect(parsed?.labels).toEqual([]);
    expect(parsed?.updatedAt).toBe('');
  });

  it('falls back to the created time when there is no update time', () => {
    expect(normalizeSearchItem(searchItem({ updated_at: undefined }))?.updatedAt)
      .toBe('2026-08-01T10:00:00Z');
  });

  it('drops labels that have no name', () => {
    expect(normalizeSearchItem(searchItem({ labels: [{ name: 'a' }, null, {}]}))?.labels).toEqual([ 'a' ]);
    expect(normalizeSearchItem(searchItem({ labels: null }))?.labels).toEqual([]);
  });
});

describe('applyDetail', () => {
  it('fills in what the search could not say', () => {
    const enriched = applyDetail(pr({ branch: '', headSha: '', detailLoaded: false }), prDetail());
    expect(enriched.branch).toBe('renovate/lodash-4.x');
    expect(enriched.baseBranch).toBe('master');
    expect(enriched.headSha).toBe('deadbeef');
    expect(enriched.mergeable).toBe('MERGEABLE');
    expect(enriched.detailLoaded).toBe(true);
  });

  it('reads mergeability, including the null GitHub sends while it works it out', () => {
    expect(applyDetail(pr(), prDetail({ mergeable: false })).mergeable).toBe('CONFLICTING');
    expect(applyDetail(pr(), prDetail({ mergeable: null })).mergeable).toBe('UNKNOWN');
  });

  it('reads whether the viewer could merge it themselves', () => {
    for (const permissions of [{ push: true }, { maintain: true }, { admin: true }]) {
      expect(applyDetail(pr(), prDetail({ base: { repo: { permissions }}})).viewerCanMerge).toBe(true);
    }
    expect(applyDetail(pr(), prDetail({ base: { repo: { permissions: { push: false }}}})).viewerCanMerge)
      .toBe(false);
  });

  it('keeps what it had when the detail names no permissions at all', () => {
    expect(applyDetail(pr({ viewerCanMerge: true }), prDetail({ base: { repo: {}}})).viewerCanMerge)
      .toBe(true);
    expect(applyDetail(pr({ viewerCanMerge: true }), prDetail({ base: null })).viewerCanMerge).toBe(true);
  });

  it('keeps what it had for anything the detail leaves out', () => {
    const before = pr({ branch: 'kept', baseBranch: 'kept-base', headSha: 'kept-sha' });
    const after = applyDetail(before, { head: null, base: null });
    expect(after.branch).toBe('kept');
    expect(after.baseBranch).toBe('kept-base');
    expect(after.headSha).toBe('kept-sha');
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('re-parses now that the branch is known', () => {
    const before = pr({ title: 'Merge branch master into develop', branch: '', detailLoaded: false });
    expect(before.parse.source).toBe('unknown');
    const after = applyDetail(before, prDetail({ head: { ref: 'renovate/lodash-4.x', sha: 'abc' }}));
    expect(after.parse.source).toBe('branch');
    expect(after.parse.updates[0]?.groupKey).toBe('lodash');
  });

  it('parses the body when the detail carries one', () => {
    const withBody = applyDetail(pr({ bodyLoaded: false }), prDetail({
      body: '| Package | Update |\n|---|---|\n| lodash | patch |',
    }));
    expect(withBody.bodyLoaded).toBe(true);
    expect(withBody.parse.source).toBe('body');
  });

  it('never throws away a body the search already gave it', () => {
    const fromSearch = pr({
      title: 'Update all non-major dependencies',
      branch: '',
      detailLoaded: false,
      bodyLoaded: true,
      parse: {
        updates: [{ depName: 'eslint', groupKey: 'eslint', updateType: 'minor', source: 'body' }],
        isGroupPr: true,
        groupName: undefined,
        updateType: 'minor',
        source: 'body',
        disagreements: [],
      },
    });
    const after = applyDetail(fromSearch, prDetail({ body: null }));
    expect(after.parse.source).toBe('body');
    expect(after.parse.updates.map(update => update.groupKey)).toEqual([ 'eslint' ]);
    // The rest of the detail still lands.
    expect(after.branch).toBe('renovate/lodash-4.x');
  });

  it('parses from the branch when no body has been seen at all', () => {
    expect(applyDetail(pr({ bodyLoaded: false }), prDetail({ body: null })).bodyLoaded).toBe(false);
  });
});

describe('applyChecks', () => {
  it('reads check runs', () => {
    const enriched = applyChecks(pr({ checks: [], checkState: 'none' }), [
      { name: 'build', status: 'completed', conclusion: 'success', details_url: 'https://ci/1' },
      { name: 'lint', status: 'completed', conclusion: 'failure', details_url: null },
    ], NO_STATUS);
    expect(enriched.checks).toEqual([
      { name: 'build', state: 'success', url: 'https://ci/1' },
      { name: 'lint', state: 'failure', url: undefined },
    ]);
    expect(enriched.checkState).toBe('failure');
  });

  it('reads commit statuses beside them, because a repository may use either half of CI', () => {
    const enriched = applyChecks(pr(), [], {
      state: 'pending',
      statuses: [
        { context: 'ci/travis', state: 'pending', target_url: 'https://travis' },
        { context: 'ci/none', state: 'success', target_url: null },
        { context: 'ci/silent' },
        null,
        {},
      ],
    });
    expect(enriched.checks).toEqual([
      { name: 'ci/travis', state: 'pending', url: 'https://travis' },
      { name: 'ci/none', state: 'success', url: undefined },
      { name: 'ci/silent', state: 'none', url: undefined },
    ]);
    expect(enriched.checkState).toBe('pending');
  });

  it('reads a commit with neither as having no checks', () => {
    const enriched = applyChecks(pr(), [], { statuses: null });
    expect(enriched.checks).toEqual([]);
    expect(enriched.checkState).toBe('none');
  });
});

describe('reviewDecisionFrom', () => {
  it('has nothing to say about a pull request nobody reviewed', () => {
    expect(reviewDecisionFrom([])).toBeNull();
  });

  it('reports an approval', () => {
    expect(reviewDecisionFrom([{ state: 'APPROVED', user: { login: 'a' }}])).toBe('APPROVED');
  });

  it('lets a request for changes outweigh any number of approvals', () => {
    expect(reviewDecisionFrom([
      { state: 'APPROVED', user: { login: 'a' }},
      { state: 'APPROVED', user: { login: 'b' }},
      { state: 'CHANGES_REQUESTED', user: { login: 'c' }},
    ])).toBe('CHANGES_REQUESTED');
  });

  it('counts only the latest verdict of each reviewer', () => {
    expect(reviewDecisionFrom([
      { state: 'CHANGES_REQUESTED', user: { login: 'a' }},
      { state: 'APPROVED', user: { login: 'a' }},
    ])).toBe('APPROVED');
    expect(reviewDecisionFrom([
      { state: 'APPROVED', user: { login: 'a' }},
      { state: 'DISMISSED', user: { login: 'a' }},
    ])).toBeNull();
  });

  it('ignores comments, which are not verdicts', () => {
    expect(reviewDecisionFrom([
      { state: 'APPROVED', user: { login: 'a' }},
      { state: 'COMMENTED', user: { login: 'a' }},
    ])).toBe('APPROVED');
  });

  it('ignores a review with no author', () => {
    expect(reviewDecisionFrom([{ state: 'APPROVED' }])).toBeNull();
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
