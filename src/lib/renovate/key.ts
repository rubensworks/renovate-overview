/**
 * Normalises a dependency name into the key everything is grouped by.
 *
 * The whole point is that the same dependency reaches us spelled several ways: a title says
 * `@types/node`, a branch says `types-node`, and both must land in one group. Lowercasing and
 * collapsing every run of non-alphanumerics into a single dash makes them equal.
 * @param depName A dependency name from any source.
 */
export function normalizeKey(depName: string): string {
  return depName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');
}
