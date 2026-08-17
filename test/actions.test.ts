import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NothingToDoError,
  backoffFor,
  checkRebaseBox,
  failedRunIds,
  isActionAvailable,
  mergeMethodFor,
  runAction,
  runIdFromCheckUrl,
} from '../src/lib/actions';
import type { GitHubClient } from '../src/lib/githubClient';
import type { ActionKind } from '../src/lib/types';
import { SETTINGS, pr } from './fixtures';

const REBASE_LINE = ' - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box';

class HttpError extends Error {
  public readonly status: number;
  public readonly response: { headers: Record<string, unknown> };

  public constructor(status: number, headers: Record<string, unknown> = {}) {
    super('boom');
    this.status = status;
    this.response = { headers };
  }
}

interface IStubClient {
  mergePr: Mock<() => Promise<void>>;
  approvePr: Mock<() => Promise<void>>;
  closePr: Mock<() => Promise<void>>;
  getPrBody: Mock<() => Promise<string>>;
  setPrBody: Mock<() => Promise<void>>;
  rerunFailedJobs: Mock<() => Promise<void>>;
}

function stubClient(): IStubClient {
  return {
    mergePr: vi.fn(async() => {}),
    approvePr: vi.fn(async() => {}),
    closePr: vi.fn(async() => {}),
    getPrBody: vi.fn(async() => ''),
    setPrBody: vi.fn(async() => {}),
    rerunFailedJobs: vi.fn(async() => {}),
  };
}

let client: IStubClient;

beforeEach(() => {
  client = stubClient();
});

function asClient(): GitHubClient {
  return <GitHubClient> <unknown> client;
}

describe('checkRebaseBox', () => {
  it('ticks the box on the line carrying the marker comment', () => {
    const body = `Intro\n${REBASE_LINE}\nOutro`;
    expect(checkRebaseBox(body)).toBe(`Intro\n - [x] <!-- rebase-check -->If you want to rebase/retry this PR, check this box\nOutro`);
  });

  it('matches the comment, not the prose, which is not stable', () => {
    const body = ' - [ ] <!--rebase-check-->Voulez-vous rebaser cette PR ?';
    expect(checkRebaseBox(body)).toContain('- [x]');
  });

  it('leaves other checkboxes alone', () => {
    const body = ` - [ ] Some other box\n${REBASE_LINE}`;
    const next = checkRebaseBox(body) ?? '';
    expect(next.split('\n')[0]).toBe(' - [ ] Some other box');
    expect(next.split('\n')[1]).toContain('- [x]');
  });

  it('has nothing to do when the box is already ticked', () => {
    expect(checkRebaseBox(' - [x] <!-- rebase-check -->already asked')).toBeUndefined();
  });

  it('has nothing to do when there is no such box', () => {
    expect(checkRebaseBox('A body with no checkbox at all')).toBeUndefined();
    expect(checkRebaseBox('')).toBeUndefined();
  });
});

const NO_URL: string | undefined = undefined;

describe('runIdFromCheckUrl', () => {
  it('reads the run id out of an Actions URL', () => {
    expect(runIdFromCheckUrl('https://github.com/o/r/actions/runs/1234567/job/89')).toBe(1_234_567);
  });

  it('finds nothing in a URL that is not an Actions one', () => {
    expect(runIdFromCheckUrl('https://ci.example.com/build/7')).toBeUndefined();
    expect(runIdFromCheckUrl(NO_URL)).toBeUndefined();
  });

  it('refuses a run id that is not a usable number', () => {
    expect(runIdFromCheckUrl('https://github.com/o/r/actions/runs/0')).toBeUndefined();
    expect(runIdFromCheckUrl(`https://github.com/o/r/actions/runs/${'9'.repeat(30)}`)).toBeUndefined();
  });
});

describe('failedRunIds', () => {
  it('collects the runs behind the failed checks only, without repeats', () => {
    const target = pr({ checks: [
      { name: 'a', state: 'failure', url: 'https://github.com/o/r/actions/runs/1/job/1' },
      { name: 'b', state: 'error', url: 'https://github.com/o/r/actions/runs/1/job/2' },
      { name: 'c', state: 'failure', url: 'https://github.com/o/r/actions/runs/2' },
      { name: 'd', state: 'success', url: 'https://github.com/o/r/actions/runs/3' },
      { name: 'e', state: 'failure', url: undefined },
    ]});
    expect(failedRunIds(target)).toEqual([ 1, 2 ]);
  });
});

describe('mergeMethodFor', () => {
  it('uses the default', () => {
    expect(mergeMethodFor('a/b', SETTINGS)).toBe('squash');
  });

  it('prefers the override a repository has, whatever its casing', () => {
    const settings = { ...SETTINGS, repoMergeMethods: { 'a/b': <const> 'rebase' }};
    expect(mergeMethodFor('A/B', settings)).toBe('rebase');
  });
});

describe('isActionAvailable', () => {
  it('does not offer to merge something that cannot be merged', () => {
    expect(isActionAvailable('merge', pr({ mergeable: 'CONFLICTING' }))).toBe(false);
    expect(isActionAvailable('merge', pr({ isDraft: true }))).toBe(false);
    expect(isActionAvailable('merge', pr())).toBe(true);
  });

  it('does not offer to approve what is already approved', () => {
    expect(isActionAvailable('approve', pr({ reviewDecision: 'APPROVED' }))).toBe(false);
    expect(isActionAvailable('approve', pr())).toBe(true);
  });

  it('offers a re-run only when there is a failed run to re-run', () => {
    expect(isActionAvailable('rerun', pr())).toBe(false);
    expect(isActionAvailable('rerun', pr({ checks: [
      { name: 'a', state: 'failure', url: 'https://github.com/o/r/actions/runs/1' },
    ]}))).toBe(true);
  });

  it('always offers a rebase or a close', () => {
    expect(isActionAvailable('rebase', pr({ mergeable: 'CONFLICTING' }))).toBe(true);
    expect(isActionAvailable('close', pr({ isDraft: true }))).toBe(true);
  });
});

describe('runAction', () => {
  it('merges with the configured method', async() => {
    await runAction(asClient(), 'merge', pr(), SETTINGS);
    expect(client.mergePr).toHaveBeenCalledWith('rubensworks', 'jbr.js', 42, 'squash');
  });

  it('merges with a repository override when there is one', async() => {
    const settings = { ...SETTINGS, repoMergeMethods: { 'rubensworks/jbr.js': <const> 'merge' }};
    await runAction(asClient(), 'merge', pr(), settings);
    expect(client.mergePr).toHaveBeenCalledWith('rubensworks', 'jbr.js', 42, 'merge');
  });

  it('approves and closes', async() => {
    await runAction(asClient(), 'approve', pr(), SETTINGS);
    expect(client.approvePr).toHaveBeenCalledWith('rubensworks', 'jbr.js', 42);
    await runAction(asClient(), 'close', pr(), SETTINGS);
    expect(client.closePr).toHaveBeenCalledWith('rubensworks', 'jbr.js', 42);
  });

  it('ticks the rebase box and writes the body back', async() => {
    client.getPrBody.mockResolvedValue(REBASE_LINE);
    await runAction(asClient(), 'rebase', pr(), SETTINGS);
    expect(client.setPrBody).toHaveBeenCalledWith(
      'rubensworks',
      'jbr.js',
      42,
      expect.stringContaining('- [x]'),
    );
  });

  it('does not rewrite a body that has nothing to tick', async() => {
    client.getPrBody.mockResolvedValue('no checkbox here');
    await expect(runAction(asClient(), 'rebase', pr(), SETTINGS)).rejects.toBeInstanceOf(NothingToDoError);
    expect(client.setPrBody).not.toHaveBeenCalled();
  });

  it('re-runs every failed workflow run', async() => {
    const target = pr({ checks: [
      { name: 'a', state: 'failure', url: 'https://github.com/o/r/actions/runs/1' },
      { name: 'b', state: 'failure', url: 'https://github.com/o/r/actions/runs/2' },
    ]});
    await runAction(asClient(), 'rerun', target, SETTINGS);
    expect(client.rerunFailedJobs).toHaveBeenCalledTimes(2);
  });

  it('says there is nothing to re-run rather than calling GitHub', async() => {
    await expect(runAction(asClient(), 'rerun', pr(), SETTINGS)).rejects.toBeInstanceOf(NothingToDoError);
    expect(client.rerunFailedJobs).not.toHaveBeenCalled();
  });

  it('splits the repository name for every action', async() => {
    for (const kind of <ActionKind[]>[ 'merge', 'approve', 'close' ]) {
      await runAction(asClient(), kind, pr({ repo: 'comunica/comunica' }), SETTINGS);
    }
    expect(client.mergePr).toHaveBeenCalledWith('comunica', 'comunica', 42, 'squash');
  });
});

describe('backoffFor', () => {
  it('is silent about anything that is not a rate limit', () => {
    expect(backoffFor(new Error('offline'))).toBeUndefined();
    expect(backoffFor(new HttpError(404))).toBeUndefined();
  });

  it('honours a retry-after header', () => {
    expect(backoffFor(new HttpError(429, { 'retry-after': '30' }))).toBe(30_000);
    expect(backoffFor(new HttpError(403, { 'retry-after': '5' }))).toBe(5000);
  });

  it('falls back to a minute when GitHub does not say how long', () => {
    expect(backoffFor(new HttpError(403))).toBe(60_000);
  });
});
