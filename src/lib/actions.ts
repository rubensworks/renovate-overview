import type { GitHubClient } from './githubClient';
import { asHttpError } from './githubClient';
import type { ActionKind, IRenovatePr, ISettings, MergeMethod } from './types';

/**
 * Renovate's control checkbox is identified by the HTML comment on its line, never by the prose
 * beside it — that text has changed between Renovate versions and is translated in some setups.
 */
const REBASE_MARKER = /<!--\s*rebase-check\s*-->/u;

/**
 * The GraphQL mutation behind "enable auto-merge", which has no REST equivalent.
 */
export const AUTO_MERGE_MUTATION = `mutation($id: ID!, $method: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) {
    clientMutationId
  }
}`;

/**
 * Ticks Renovate's rebase checkbox in a pull request body.
 *
 * Returns undefined when there is nothing to do — no checkbox, or one that is already ticked —
 * so the caller can skip the write rather than pointlessly rewriting the body.
 * @param body A pull request body.
 */
export function checkRebaseBox(body: string): string | undefined {
  const lines = body.split('\n');
  const index = lines.findIndex(line => REBASE_MARKER.test(line));
  const line = index === -1 ? undefined : lines[index];
  if (line === undefined || !/- \[ \]/u.test(line)) {
    return undefined;
  }
  lines[index] = line.replace('- [ ]', '- [x]');
  return lines.join('\n');
}

/**
 * Extracts the workflow run id from a check run's details URL.
 *
 * The search query does not carry run ids, and asking for them per pull request would cost a
 * request each. The URL a check run already links to contains one, so this reads it from there
 * and the action is simply not offered when it does not.
 * @param url A check run details URL.
 */
export function runIdFromCheckUrl(url: string | undefined): number | undefined {
  if (url === undefined) {
    return undefined;
  }
  const match = /\/actions\/runs\/(\d+)/u.exec(url);
  if (match === null) {
    return undefined;
  }
  const runId = Number(match[1]);
  return Number.isSafeInteger(runId) && runId > 0 ? runId : undefined;
}

/**
 * The workflow runs behind a pull request's failed checks, deduplicated.
 * @param pr A pull request.
 */
export function failedRunIds(pr: IRenovatePr): number[] {
  const ids = pr.checks
    .filter(check => check.state === 'failure' || check.state === 'error')
    .map(check => runIdFromCheckUrl(check.url))
    .filter((runId): runId is number => runId !== undefined);
  return [ ...new Set(ids) ];
}

/**
 * The merge method to use for one repository: its own override if it has one, else the default.
 * @param repo A repository, as `owner/name`.
 * @param settings The current settings.
 */
export function mergeMethodFor(repo: string, settings: ISettings): MergeMethod {
  return settings.repoMergeMethods[repo.toLowerCase()] ?? settings.mergeMethod;
}

/**
 * Whether an action is worth offering for a pull request.
 *
 * Buttons that GitHub is certain to refuse are not shown at all: a conflicting pull request
 * cannot be merged, and re-running jobs needs a failed run to re-run.
 * @param kind The action.
 * @param pr A pull request.
 */
export function isActionAvailable(kind: ActionKind, pr: IRenovatePr): boolean {
  switch (kind) {
    case 'merge':
    case 'auto-merge':
      return pr.mergeable !== 'CONFLICTING' && !pr.isDraft;
    case 'rerun':
      return failedRunIds(pr).length > 0;
    case 'approve':
      return pr.reviewDecision !== 'APPROVED';
    case 'rebase':
    case 'close':
    default:
      return true;
  }
}

function splitRepo(repo: string): { owner: string; name: string } {
  const slash = repo.indexOf('/');
  return { owner: repo.slice(0, Math.max(0, slash)), name: repo.slice(slash + 1) };
}

/**
 * Raised when an action had nothing to do, which is not a failure.
 */
export class NothingToDoError extends Error {}

/**
 * Performs one action on one pull request.
 * @param client The GitHub client.
 * @param kind The action.
 * @param pr The pull request.
 * @param settings The current settings, which decide how to merge.
 */
export async function runAction(
  client: GitHubClient,
  kind: ActionKind,
  pr: IRenovatePr,
  settings: ISettings,
): Promise<void> {
  const { owner, name } = splitRepo(pr.repo);
  switch (kind) {
    case 'merge':
      await client.mergePr(owner, name, pr.number, mergeMethodFor(pr.repo, settings));
      return;
    case 'auto-merge':
      await client.graphql(AUTO_MERGE_MUTATION, {
        id: pr.id,
        method: mergeMethodFor(pr.repo, settings).toUpperCase(),
      }, owner);
      return;
    case 'approve':
      await client.approvePr(owner, name, pr.number);
      return;
    case 'close':
      await client.closePr(owner, name, pr.number);
      return;
    case 'rerun': {
      const runIds = failedRunIds(pr);
      if (runIds.length === 0) {
        throw new NothingToDoError('No failed workflow run to re-run');
      }
      for (const runId of runIds) {
        await client.rerunFailedJobs(owner, name, runId);
      }
      return;
    }
    case 'rebase':
    default: {
      const body = await client.getPrBody(owner, name, pr.number);
      const next = checkRebaseBox(body);
      if (next === undefined) {
        throw new NothingToDoError('No rebase checkbox to tick — Renovate may already be on it');
      }
      await client.setPrBody(owner, name, pr.number, next);
    }
  }
}

/**
 * How long to wait after a rate-limited response, in milliseconds.
 *
 * GitHub answers a secondary rate limit with `retry-after`; when it does not, a fixed pause is
 * better than hammering the endpoint that just said no.
 * @param error A thrown value.
 */
export function backoffFor(error: unknown): number | undefined {
  const httpError = asHttpError(error);
  if (httpError === undefined) {
    return undefined;
  }
  if (httpError.status !== 403 && httpError.status !== 429) {
    return undefined;
  }
  return (httpError.retryAfter ?? 60) * 1000;
}
