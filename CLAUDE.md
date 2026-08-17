# renovate-overview — working notes

A client-side-only dashboard that shows **every open Renovate pull request across the viewer's own
repositories and their organisations**, with CI status, grouping by repository or by dependency,
sorting, filtering, and bulk actions to clear the backlog.

It is the Renovate counterpart to
[`rubensworks/gh-actions-overview`](https://github.com/rubensworks/gh-actions-overview) and
deliberately follows that project's conventions: same stack, same security model, view state in the
URL fragment, the same rate-limit discipline.

## Hard constraints

These are non-negotiable. A design that violates one of them is wrong — say so rather than working
around it.

1. **No backend.** The build output is a directory of static files, deployable to GitHub Pages. No
   server, no serverless function, no proxy, no database.
2. **Only GitHub's own hosts are contacted at runtime**, and only these two:
   `https://api.github.com` for all data (REST and GraphQL alike), and
   `https://avatars.githubusercontent.com` for avatar images, which the owner explicitly allowed.
   An avatar is a plain `<img>`, so no token travels with it. Nothing else: no analytics, no error
   reporting, no CDN fonts, no third-party scripts. Any font or icon asset is self-hosted in the
   bundle, and any further host needs the owner's say-so.
3. **No Renovate network calls.** Renovate is a bot that writes to GitHub: the hosted Mend app has
   no public read API and self-hosted Renovate has none at all. Everything needed (PR title, body,
   branch name, labels, checks, the Dependency Dashboard issue, the rebase checkbox) already lives
   in GitHub's API. Never add a Renovate or Mend host — if there seems to be a reason to, stop and
   ask.
4. **The token never leaves the browser.** It is read from storage and attached as an
   `Authorization` header on requests the browser makes directly to `api.github.com`.
5. **No `dangerouslySetInnerHTML`** on anything derived from GitHub data. All API data renders as
   text through React. Markdown rendering of a PR body would need a sanitising renderer and an
   explicit decision — it is not in v1.

## Stack

- Vite + React + TypeScript, `strict` mode.
- `@octokit/rest` for both REST and GraphQL — Octokit's own `graphql()` is `@octokit/graphql`
  underneath, so pulling the package in separately would only add a second mock boundary. Both are
  wrapped in a single `src/lib/githubClient.ts` so tests mock one module.
- Vitest + `@testing-library/react` + jsdom. **No live network calls in tests, ever.**
- ESLint via `@rubensworks/eslint-config`.
- Scripts: `dev`, `build`, `preview`, `lint`, `test`, `test:watch`.
- 100% coverage thresholds are enforced in `vite.config.ts`; CI runs lint + test + build, and
  `deploy.yml` publishes to GitHub Pages from the default branch.

Dashboard state lives in a plain TypeScript store consumed through `useSyncExternalStore`, not in
React component state, so the polling scheduler stays testable with fake timers.

## Layout

```
src/
  app.tsx                    Session, settings, routing between setup and dashboard
  components/                Presentational components only
  lib/
    githubClient.ts          Octokit wrapper: auth, conditional requests, rate-limit bookkeeping
    search.ts                Builds the search query, paginates, normalises results
    renovate/
      identify.ts            Is this PR a Renovate PR, and from which bot?
      parseTitle.ts          Title -> dependency/update-type/versions
      parseBody.ts           Renovate PR body table -> structured dependency rows
      parseBranch.ts         Branch name -> dependency hint
      resolve.ts             Combines the three above with a defined precedence
    store.ts                 Dashboard state + polling scheduler, via useSyncExternalStore
    selectors.ts             Filtering, grouping, sorting, aggregation
    actions.ts               Write operations (merge, approve, rebase, close)
    storage.ts               Token and settings persistence
    urlState.ts              Filters/grouping/sorting in the URL fragment
test/                        Mirrors src/
```

## Authentication

Fine-grained PAT, pasted by the user. A fine-grained token is bound to one resource owner, so a
personal token cannot see an organisation's private repositories — hence per-organisation tokens.

- Main token in `localStorage` under `renovate-overview:token`, or `sessionStorage` when the user
  ticks "don't remember me".
- Organisation tokens under `renovate-overview:owner-tokens`, keyed by org login, same storage.
  Validate against `GET /orgs/{org}/repos` before storing, so a wrongly scoped token is rejected
  instead of silently degrading to public-only results.
- Every request about an org uses that org's token when present, otherwise the main token.
- Sign out clears both storages. A stored token is never rendered back into the DOM.

**Write actions are gated behind a settings toggle that is off by default**, and the UI shows a
clear read-only indicator. A first-run user must get value from a token with no write scopes.

## Fetching

GraphQL search is the primary path: one query returns the PRs *and* their check rollups together.
The query is built from `viewer { login }` (resolved once and cached) plus the configured orgs:

```
is:open is:pr archived:false author:app/renovate user:<login> org:<org1> org:<org2>
```

The scope qualifiers are **mandatory** — without at least one, `author:app/renovate` searches all of
GitHub. Assert this in code.

Traps to remember:

- Do **not** request `body` in the bulk query; Renovate bodies carry full release notes. Fetch them
  lazily (§5.3 of the brief) and cache parsed results keyed by `prId + updatedAt`.
- `statusCheckRollup` is null when the head commit has no checks — render "no checks" (grey), not a
  failure.
- `mergeable` is computed asynchronously and often returns `UNKNOWN` first; re-query those PRs once
  after a short delay.
- `mergeStateStatus` is optional enrichment only (needs the `merge-info-preview` Accept header),
  never a hard dependency.
- Search caps at 1000 results and lags reality by seconds. Near the cap, split into one search per
  owner and merge; warn in the footer if a single owner still exceeds it.
- Paginate with `after`/`endCursor`, `first: 50`, and render progressively.
- Report `rateLimit.cost` and `remaining` in the footer.

REST is better where polling is frequent: `304 Not Modified` does not count against the REST rate
limit and GraphQL has no equivalent, so refresh pending checks over
`GET /repos/{o}/{r}/commits/{ref}/check-runs` with `If-None-Match`. Cache every ETag.

Bot logins that count as Renovate, configurable with these defaults: `renovate[bot]` (hosted Mend
app, `author:app/renovate` in query syntax), `renovate-bot`, `renovate`. `dependabot[bot]` sits
behind its own toggle with clearly separate parsing. Secondary signals for self-hosted bots under
unknown logins: `renovate/` branch prefix, `dependencies` label, the
`This PR has been generated by Renovate Bot` footer.

## Parsing (the hard part)

Grouping by dependency is why this app exists, and it lives or dies on parsing. Written **test
first** against a fixture file of real Renovate titles and bodies. Every regex will meet a title it
does not expect: degrade to `unknown`, never crash and never group wrongly.

- Precedence: `parseBody` (when loaded) → `parseTitle` → `parseBranch` → `unknown`. Record which
  source won so an inspect view can show it; when sources disagree, prefer the body but keep the
  disagreement visible.
- A PR that resolves to `unknown` still appears, in an "Unrecognised" group. Never silently dropped.
- Grouping key is normalised (lowercased; `@types/node` and `types-node` are the same key).
- A group PR belongs to **every** dependency it contains, badged "+N more", and is deduplicated so
  it is not counted twice in a group's PR count.
- Body tables are parsed **by header name, not column index** — `prBodyColumns` is configurable.
- Strip Renovate marker comments when parsing: `<!-- rebase-check -->`, `<!--renovate-debug:…-->`,
  `<!--renovate-config-hash:…-->`.

## Actions

Off unless the write toggle is on. Every destructive or bulk action goes through a confirmation
dialog naming exactly what will happen and to how many PRs.

Per PR: merge (`PUT …/pulls/{n}/merge`, configurable method with a per-repo override), enable
auto-merge (GraphQL `enablePullRequestAutoMerge`), approve (`POST …/reviews`, `event: APPROVE`),
request a Renovate rebase (flip `- [ ]` to `- [x]` on the line carrying the `<!-- rebase-check -->`
comment — match on the comment, not the human-readable text — then `PATCH` the PR), close (warn that
Renovate reads a closed PR as "ignore this update"), and re-run failed jobs when the Actions write
permission is present.

Bulk actions run **sequentially** with a visible progress list and per-PR results, stop the queue on
repeated failures, and back off on `403`/`429` with `retry-after`. After any write, refresh only the
affected PRs.

## Refreshing

Manual refresh plus background polling (~2 min default), pending PRs polled faster (~30 s) and
jittered, paused while the tab is hidden. Conditional requests everywhere on the REST path. Show
remaining REST and GraphQL quota in the footer, slow polling as it drains, and stop before zero
while saying so. Handle `403`/`429` with `retry-after` and secondary rate limits as first-class
states. Reflect overall state in the favicon and page title so a pinned tab is a passive monitor.

## Build order

1. **Scaffold** — Vite + React + TS, ESLint, Vitest, CI, Pages deploy, `renovate.json`, this file.
2. **Auth** — setup screen, token validation, storage, sign-out, per-org tokens, read-only default.
3. **Fetch + flat list** — GraphQL search, pagination, progressive render, check-status colouring,
   rate-limit footer.
4. **Parser** — test-first, with the fixtures.
5. **Grouping, sorting, filtering, URL state** — including lazy body loading.
6. **Actions** — per-PR, then selection and bulk, then confirmation and progress UI.
7. **Polish** — theme, mobile layout, favicon and title status, keyboard shortcuts, empty and error
   states, README token instructions.

Stop at each milestone and wait for review before continuing.

## Ask rather than guess

- If search results approach 1000 and per-owner splitting is still not enough.
- If a Renovate title format cannot be handled without making the parser unreadable.
- If any feature seems to require a host beyond `api.github.com` and the avatar CDN.
- If a write action needs a permission beyond those documented in the README.
