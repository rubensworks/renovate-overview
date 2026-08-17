/**
 * The text of a capture group.
 *
 * `exec` types every group as possibly absent, because an optional group can match nothing. A
 * group that is not optional always matched when the pattern did, so the fallback here can never
 * be taken from the patterns in this directory — keeping it in one place is better than spreading
 * an unreachable `?? ''` across every call site.
 * @param match A successful match.
 * @param index The one-based index of the capture group.
 */
export function captured(match: RegExpExecArray, index: number): string {
  return match[index] ?? '';
}
