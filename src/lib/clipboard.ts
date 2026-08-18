import type { GroupMode, IGroup } from './selectors';
import type { IRenovatePr } from './types';

/**
 * How a pull request names the dependency it updates, the same way its row headlines it.
 *
 * A group pull request prefers the name Renovate gave the group — `all non-major dependencies` —
 * and falls back to listing its packages. A pull request nothing could be parsed out of falls
 * back to its title, so a line is never blank.
 * @param pr A pull request.
 */
function depLabel(pr: IRenovatePr): string {
  const names = pr.parse.updates.map(update => update.depName);
  if (names.length > 1) {
    return pr.parse.groupName ?? names.join(', ');
  }
  return names[0] ?? pr.parse.groupName ?? pr.title;
}

/**
 * How one pull request is named in a group's text, given what that group is keyed on.
 *
 * The heading already carries the thing every pull request in the group has in common, so
 * repeating it on every line would be noise. What each line carries is what varies: under a
 * dependency the repositories, under a repository the dependencies, and under anything broader
 * both.
 * @param pr A pull request.
 * @param mode How the group it is in was formed.
 */
function bulletFor(pr: IRenovatePr, mode: GroupMode): string {
  switch (mode) {
    case 'dependency':
      return pr.repo;
    case 'repo':
      return depLabel(pr);
    default:
      return `${pr.repo} — ${depLabel(pr)}`;
  }
}

/**
 * Renders a group as plain text: its name, then one bullet per pull request in it.
 *
 * The shape is deliberately the plainest thing that survives being pasted anywhere — a chat
 * message, an issue, a prompt to a model — so no links, no numbers, no counts and no markdown
 * beyond the bullets:
 *
 * ```
 * typescript:
 *
 * * rubensworks/rdf-parse.js
 * * rubensworks/rdf-serialize.js
 * ```
 *
 * Every pull request in the group gets its own line, in the order the group is already displayed
 * in, so the text accounts for exactly as many pull requests as the header counts. Two lines can
 * therefore read the same — better a repeated line than a pull request quietly missing from a
 * list somebody is about to work from.
 * @param group A group of pull requests.
 * @param mode How that group was formed, which decides what each line says.
 */
export function formatGroupAsText(group: IGroup, mode: GroupMode): string {
  const lines = group.prs.map(pr => `* ${bulletFor(pr, mode)}`);
  return `${group.label}:\n\n${lines.join('\n')}\n`;
}

/**
 * Puts text on the clipboard.
 *
 * The clipboard is unavailable over plain HTTP and can be refused by the user, so this reports
 * whether it worked rather than throwing: a button that quietly did nothing would be worse than
 * one that says it could not.
 * @param text What to copy.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
