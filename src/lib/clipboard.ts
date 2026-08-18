import type { IGroup } from './selectors';

/**
 * Renders a group as plain text: its name, then one bullet per repository in it.
 *
 * The shape is deliberately the plainest thing that survives being pasted anywhere — a chat
 * message, an issue, a prompt to a model — so no links, no counts and no markdown beyond the
 * bullets:
 *
 * ```
 * typescript:
 *
 * * rubensworks/rdf-parse.js
 * * rubensworks/rdf-serialize.js
 * ```
 *
 * A repository is listed once however many of the group's pull requests it has, and the order is
 * the order the group is already displayed in, so the text matches what is on screen.
 * @param group A group of pull requests.
 */
export function formatGroupAsText(group: IGroup): string {
  const repos: string[] = [];
  const seen = new Set<string>();
  for (const pr of group.prs) {
    if (!seen.has(pr.repo)) {
      seen.add(pr.repo);
      repos.push(pr.repo);
    }
  }
  return `${group.label}:\n\n${repos.map(repo => `* ${repo}`).join('\n')}\n`;
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
