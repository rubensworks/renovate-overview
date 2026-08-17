/**
 * Renovate pull request bodies, with the marker comments and the column layouts that
 * `prBodyColumns` actually produces. Release notes are trimmed; the table is the point.
 */

/**
 * The default layout: Package, Type, Update, Change.
 */
export const DEFAULT_BODY = `This PR contains the following updates:

| Package | Type | Update | Change |
|---|---|---|---|
| [@sentry/cli](https://redirect.github.com/getsentry/sentry-cli) ([source](https://redirect.github.com/getsentry/sentry-cli)) | dependencies | minor | [\`1.53.0\` -> \`1.54.0\`](https://renovatebot.com/diffs/npm/@sentry%2fcli/1.53.0/1.54.0) |

---

### Configuration

📅 **Schedule**: Branch creation - "before 4am" in timezone Europe/Brussels.

---

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box

<!--renovate-debug:eyJjcmVhdGVkSW5WZXIiOiIzNy4yMjEuMCJ9-->
`;

/**
 * The columns in a different order, with Pending and without Type — a `prBodyColumns` override.
 * Parsing by header name rather than by position is what this fixture is for.
 */
export const REORDERED_BODY = `This PR contains the following updates:

| Update | Change | Pending | Package |
|---|---|---|---|
| major | [\`4.17.20\` -> \`5.0.0\`](https://diff) | \`5.0.1\` | [lodash](https://github.com/lodash/lodash) |

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box
`;

/**
 * Separate current-value and new-value columns instead of a combined Change column.
 */
export const SPLIT_VERSION_BODY = `| Package | Manager | Current value | New value |
| --- | --- | --- | --- |
| [typescript](https://www.typescriptlang.org/) | npm | \`5.3.3\` | \`5.4.2\` |
`;

/**
 * A group pull request: eight packages in one table, which is the thing title parsing can never do.
 */
export const GROUP_BODY = `This PR contains the following updates:

| Package | Type | Update | Change |
|---|---|---|---|
| [@babel/core](https://babel.dev) | devDependencies | minor | [\`7.23.0\` -> \`7.24.0\`](https://diff) |
| [@babel/preset-env](https://babel.dev) | devDependencies | minor | [\`7.23.0\` -> \`7.24.0\`](https://diff) |
| [@types/node](https://redirect.github.com/DefinitelyTyped/DefinitelyTyped) | devDependencies | patch | [\`20.11.4\` -> \`20.11.5\`](https://diff) |
| [eslint](https://eslint.org) | devDependencies | minor | [\`8.56.0\` -> \`8.57.0\`](https://diff) |
| [jest](https://jestjs.io) | devDependencies | patch | [\`29.7.0\` -> \`29.7.1\`](https://diff) |
| [lodash](https://lodash.com) | dependencies | patch | [\`4.17.20\` -> \`4.17.21\`](https://diff) |
| [typescript](https://www.typescriptlang.org/) | devDependencies | minor | [\`5.3.3\` -> \`5.4.0\`](https://diff) |
| [vite](https://vitejs.dev) | devDependencies | major | [\`5.4.0\` -> \`6.0.0\`](https://diff) |

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box
`;

/**
 * A GitHub Actions digest update, whose Change column holds shas rather than versions.
 */
export const ACTION_DIGEST_BODY = `| Package | Type | Update | Change |
|---|---|---|---|
| [docker/build-push-action](https://redirect.github.com/docker/build-push-action) | action | digest | [\`a1b2c3d\` -> \`e4f5a6b\`](https://diff) |
`;

/**
 * A body whose table is preceded by a heading and followed by release notes containing tables of
 * their own. Only the first table with a Package column may be read.
 */
export const RELEASE_NOTES_BODY = `This PR contains the following updates:

| Package | Update | Change |
|---|---|---|
| [vite](https://vitejs.dev) | major | [\`5.4.0\` -> \`6.0.0\`](https://diff) |

---

### Release Notes

<details>
<summary>vitejs/vite (vite)</summary>

| Benchmark | Before | After |
|---|---|---|
| cold start | 1.2s | 0.8s |

</details>
`;

/**
 * A lock file maintenance pull request, whose body carries no table at all.
 */
export const NO_TABLE_BODY = `This PR contains the following updates:

🔧 This Pull Request updates lock files to use the latest dependency versions.

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box
`;

/**
 * A table with a Package column that holds nothing usable.
 */
export const EMPTY_ROWS_BODY = `| Package | Update |
|---|---|
|  | minor |
| [](https://nowhere) | patch |
`;

/**
 * Dependabot's body, which is prose rather than a table.
 */
export const DEPENDABOT_BODY = `Bumps [lodash](https://github.com/lodash/lodash) from 4.17.20 to 4.17.21.

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself.
`;

/**
 * A table that is not the dependency table, standing in front of the one that is. Finding the
 * table by its Package column rather than by being first is what this fixture is for.
 */
export const LEADING_OTHER_TABLE_BODY = `| Benchmark | Before | After |
|---|---|---|
| cold start | 1.2s | 0.8s |

| Package | Update | Change |
|---|---|---|
| [vite](https://vitejs.dev) | major | [\`5.4.0\` -> \`6.0.0\`](https://diff) |
`;

/**
 * A Change column that holds a single value rather than an arrow between two.
 */
export const ONE_SIDED_CHANGE_BODY = `| Package | Change |
|---|---|
| lodash | \`4.17.21\` |
`;

/**
 * A row with fewer cells than the header promises. Markdown does not require them to line up, and
 * a missing trailing cell must cost that one field rather than the whole row.
 */
export const SHORT_ROW_BODY = `| Package | Type | Update | Change |
|---|---|---|---|
| lodash | dependencies |
`;
