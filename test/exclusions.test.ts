import { describe, expect, it } from 'vitest';
import {
  MAX_QUERY_LENGTH,
  excludeQualifiers,
  filterExcluded,
  isExcluded,
  normalizeExclusions,
  normalizeRepo,
} from '../src/lib/exclusions';
import { pr } from './fixtures';

describe('normalizeRepo', () => {
  it('lowercases an owner/name', () => {
    expect(normalizeRepo('Comunica/Incremunica')).toBe('comunica/incremunica');
  });

  it('trims whitespace and a leading at-sign', () => {
    expect(normalizeRepo('  @comunica/incremunica ')).toBe('comunica/incremunica');
  });

  it('accepts a repository URL, with or without its scheme, www or .git suffix', () => {
    expect(normalizeRepo('https://github.com/comunica/incremunica')).toBe('comunica/incremunica');
    expect(normalizeRepo('github.com/comunica/incremunica/')).toBe('comunica/incremunica');
    expect(normalizeRepo('http://www.github.com/comunica/incremunica.git')).toBe('comunica/incremunica');
  });

  it('keeps the dots and dashes a repository name is allowed', () => {
    expect(normalizeRepo('rubensworks/jbr.js')).toBe('rubensworks/jbr.js');
    expect(normalizeRepo('CyclopsMC/forge-update-generator.js')).toBe('cyclopsmc/forge-update-generator.js');
  });

  it('refuses anything that is not one repository', () => {
    expect(normalizeRepo('comunica')).toBeUndefined();
    expect(normalizeRepo('')).toBeUndefined();
    expect(normalizeRepo('comunica/incremunica/tree/master')).toBeUndefined();
    expect(normalizeRepo('comunica/*')).toBeUndefined();
  });
});

describe('normalizeExclusions', () => {
  it('normalises every entry and drops the unreadable ones', () => {
    expect(normalizeExclusions([ 'Comunica/Incremunica', 'nonsense', 'https://github.com/rubensworks/jbr.js' ]))
      .toEqual([ 'comunica/incremunica', 'rubensworks/jbr.js' ]);
  });

  it('keeps one entry per repository, however it was spelled', () => {
    expect(normalizeExclusions([ 'comunica/incremunica', '@Comunica/Incremunica' ]))
      .toEqual([ 'comunica/incremunica' ]);
  });
});

describe('isExcluded', () => {
  it('matches whatever the casing', () => {
    expect(isExcluded('Comunica/Incremunica', [ 'comunica/incremunica' ])).toBe(true);
  });

  it('does not match a repository that is merely owned by the same account', () => {
    expect(isExcluded('comunica/comunica', [ 'comunica/incremunica' ])).toBe(false);
  });
});

describe('filterExcluded', () => {
  const prs = [ pr(), pr({ id: 'x', repo: 'comunica/incremunica', owner: 'comunica' }) ];

  it('drops the pull requests of an excluded repository', () => {
    expect(filterExcluded(prs, [ 'comunica/incremunica' ])).toEqual([ prs[0] ]);
  });

  it('hands back the very same list when nothing is excluded', () => {
    expect(filterExcluded(prs, [])).toBe(prs);
  });
});

describe('excludeQualifiers', () => {
  it('names the repositories of the owners this search covers', () => {
    expect(excludeQualifiers(
      [ 'comunica/incremunica', 'rubensworks/jbr.js' ],
      [ 'comunica' ],
      MAX_QUERY_LENGTH,
    )).toEqual([ '-repo:comunica/incremunica' ]);
  });

  it('ignores the casing and the padding of the owners it is given', () => {
    expect(excludeQualifiers([ 'comunica/incremunica' ], [ ' Comunica ' ], MAX_QUERY_LENGTH))
      .toEqual([ '-repo:comunica/incremunica' ]);
  });

  it('stops once the query has no room left, leaving the rest to the filter', () => {
    const excluded = [ 'comunica/one', 'comunica/two', 'comunica/three' ];
    // Room for `-repo:comunica/one` and its separating space, and nothing more.
    expect(excludeQualifiers(excluded, [ 'comunica' ], 19)).toEqual([ '-repo:comunica/one' ]);
    expect(excludeQualifiers(excluded, [ 'comunica' ], 0)).toEqual([]);
  });
});
