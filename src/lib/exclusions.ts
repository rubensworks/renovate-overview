import type { IRenovatePr } from './types';

/**
 * How long a search query may be. GitHub rejects anything past this, so the exclusions that fit
 * are pushed into the query and the rest are left to {@link filterExcluded}.
 */
export const MAX_QUERY_LENGTH = 256;

/**
 * `owner/name`, as GitHub allows it to be spelled: letters, digits, dots, dashes, underscores.
 */
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/u;

/**
 * Reads one entry of the exclusion list as a repository.
 *
 * A repository is typed, pasted or copied out of the address bar, so `comunica/incremunica`,
 * `@comunica/incremunica` and `https://github.com/comunica/incremunica` all have to mean the same
 * thing. Anything that is not a repository at all — an owner on its own, a URL to something else —
 * is `undefined` rather than a pattern that quietly matches nothing.
 * @param entry One line of the exclusion list.
 */
export function normalizeRepo(entry: string): string | undefined {
  const trimmed = entry
    .trim()
    .toLowerCase()
    .replace(/^@/u, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//u, '')
    .replace(/\.git$/u, '')
    .replace(/\/+$/u, '');
  return REPO_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Reads the exclusion list into lowercased `owner/name` entries, dropping what it cannot read.
 *
 * The settings keep what was typed, so a line being edited is never rewritten under the cursor;
 * this is what everything else compares against.
 * @param entries The configured exclusions.
 */
export function normalizeExclusions(entries: string[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    const repo = normalizeRepo(entry);
    if (repo !== undefined) {
      seen.add(repo);
    }
  }
  return [ ...seen ];
}

/**
 * Whether a repository is on the exclusion list.
 * @param repo An `owner/name`, in any casing.
 * @param excluded Normalised exclusions, from {@link normalizeExclusions}.
 */
export function isExcluded(repo: string, excluded: string[]): boolean {
  return excluded.includes(repo.toLowerCase());
}

/**
 * Drops the pull requests of excluded repositories.
 *
 * This is what actually guarantees an excluded repository stays off the dashboard: the query
 * qualifiers below are an optimisation that a long list or a stale search can outgrow, this is not.
 * @param prs Some pull requests.
 * @param excluded Normalised exclusions.
 */
export function filterExcluded(prs: IRenovatePr[], excluded: string[]): IRenovatePr[] {
  if (excluded.length === 0) {
    return prs;
  }
  const set = new Set(excluded);
  return prs.filter(pr => !set.has(pr.repo.toLowerCase()));
}

/**
 * The `-repo:` qualifiers to append to one scope's search, so excluded repositories are never
 * fetched in the first place.
 *
 * Repeated qualifiers are combined with AND under `advanced_search=true`, which is a trap for the
 * `OR` groups elsewhere in the query but exactly right here: `-repo:a -repo:b` means neither.
 *
 * Two things bound this list. Only repositories belonging to an owner this search covers are worth
 * naming, since the others cannot match it anyway; and the query has a length limit, so terms are
 * added only while they fit. Whatever does not fit is dropped here and removed from the results
 * instead — the query saves requests, it does not decide what is shown.
 * @param excluded Normalised exclusions.
 * @param owners The owners this search covers.
 * @param budget How many characters are left for these terms, separating spaces included.
 */
export function excludeQualifiers(excluded: string[], owners: string[], budget: number): string[] {
  const scoped = new Set(owners.map(owner => owner.trim().toLowerCase()));
  const terms: string[] = [];
  let used = 0;
  for (const repo of excluded) {
    if (!scoped.has(repo.slice(0, Math.max(0, repo.indexOf('/'))))) {
      continue;
    }
    const term = `-repo:${repo}`;
    // The space that joins this term to the query counts against the limit too.
    if (used + term.length + 1 > budget) {
      break;
    }
    used += term.length + 1;
    terms.push(term);
  }
  return terms;
}
