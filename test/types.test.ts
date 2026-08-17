import { describe, expect, it } from 'vitest';
import { DEFAULT_RENOVATE_AUTHORS, DEPENDABOT_AUTHOR } from '../src/lib/types';

describe('DEFAULT_RENOVATE_AUTHORS', () => {
  it('covers the hosted app and the usual self-hosted service accounts', () => {
    expect(DEFAULT_RENOVATE_AUTHORS).toEqual([ 'renovate[bot]', 'renovate-bot', 'renovate' ]);
  });
});

describe('DEPENDABOT_AUTHOR', () => {
  it('is kept apart from the Renovate logins, since it is parsed differently', () => {
    expect(DEFAULT_RENOVATE_AUTHORS).not.toContain(DEPENDABOT_AUTHOR);
    expect(DEPENDABOT_AUTHOR).toBe('dependabot[bot]');
  });
});
