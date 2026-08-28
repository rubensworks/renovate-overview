# Renovate Overview

A **client-side-only** dashboard for every open [Renovate](https://docs.renovatebot.com/) pull
request across your own repositories and the organisations you belong to — with CI status visible at
a glance, grouping by repository *or by dependency*, sorting, filtering, and bulk actions so the
backlog can actually be cleared.

It is the Renovate counterpart to
[`gh-actions-overview`](https://github.com/rubensworks/gh-actions-overview), and follows the same
conventions.

GitHub's own search can list your Renovate PRs. What it cannot tell you is that `@types/node` is
waiting in 14 repositories, 12 of them green and 2 red — which is exactly the view that makes a
large backlog tractable.

Paste a token and you get the whole backlog: every open Renovate pull request across your account
and your organisations, grouped by dependency or by repository, sorted and filtered however you
like, with the view in the URL so you can bookmark it. Turn on write actions and you can merge,
approve, rebase and close — per pull request or over a selection.

## How it works

There is no backend. The build output is a directory of static files served from GitHub Pages, and
the only hosts contacted at runtime are `https://api.github.com` for every piece of data and
`https://avatars.githubusercontent.com` for your avatar image. Your token is read from browser
storage and attached as an `Authorization` header on requests your browser makes directly to
GitHub — it is never sent anywhere else, it never appears in a URL, and an avatar `<img>` carries
no `Authorization` header at all.

Renovate itself is never contacted: it is a bot that writes to GitHub, so everything this dashboard
needs — PR titles, bodies, branch names, labels, checks, the rebase checkbox — already lives in
GitHub's API.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed URL and paste a token.

Other scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | ESLint over the whole project |
| `npm test` | Vitest once, with coverage thresholds enforced |
| `npm run test:watch` | Vitest in watch mode |

## Tokens and permissions

Authentication uses a **fine-grained personal access token** that you paste into the app. Create one
at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens).

A fine-grained token is bound to **one resource owner**. Your personal token therefore cannot see an
organisation's private repositories, no matter its permissions — so the app lets you add a **separate
token per organisation**, and uses it for every request about that organisation. An organisation
token is validated against `GET /orgs/{org}/repos` before it is stored, so a wrongly scoped token is
rejected immediately rather than silently degrading to public-only results.

### Read-only (the default)

This is all you need to see the dashboard. Repository permissions:

- **Pull requests:** Read-only
- **Checks:** Read-only
- **Commit statuses:** Read-only

*Metadata: Read-only* is added automatically and is required.

Using a classic PAT instead? `repo` covers private repositories, `public_repo` covers public ones
only.

### Write actions (opt-in, off by default)

Write actions are hidden behind a settings toggle that is **off by default**, and the UI shows a
read-only indicator until you turn it on. Enable it only if you want the app to act on your PRs, and
grant only what you intend to use:

- **Pull requests: Read and write** — approve, close, edit the body (the Renovate rebase checkbox),
  enable auto-merge.
- **Contents: Read and write** — required to merge.
- **Actions: Read and write** — only needed for "re-run failed jobs". Without it that button
  simply is not offered.

There is no "enable auto-merge": GitHub only offers it over GraphQL, which a browser cannot reach.

Every write goes through a confirmation naming exactly what it will do and to how many pull
requests, and bulk actions run one at a time with a per-pull-request result list. A repository that
forbids your merge method answers with a 405, which is reported against that pull request rather
than stopping the rest.

### Where the token is stored

- Main token: `localStorage` under `renovate-overview:token`, or `sessionStorage` if you tick
  "don't remember me".
- Organisation tokens: `renovate-overview:owner-tokens` in the same storage.
- Settings, exclusions included: `renovate-overview:settings` in `localStorage`. No token there.

Signing out clears both storages. A stored token is never rendered back into the page.

## Leaving repositories out

Some repositories are somebody else's problem, or raise so much that they drown out everything
else. **Settings → Where to look → Excluded repositories** takes one `owner/repository` per line —
`comunica/incremunica`, or the repository's GitHub URL pasted straight in — and leaves them off the
dashboard entirely. Grouping by repository puts an **Exclude** button on every group header, which
adds that repository to the same list.

The exclusions are pushed into the search query itself as `-repo:` qualifiers, so an excluded
repository normally costs no requests at all. A search query has a length limit, so anything that
does not fit is dropped from the results instead — the query is the saving, the filter is the
guarantee.

Excluding is a local setting like any other: it changes nothing on GitHub, Renovate keeps raising
pull requests for that repository, and removing the line brings it straight back.

## Copying a group out

Every group header carries a **Copy as text** button, which puts the group on the clipboard as
plain text. The heading already names what the group is keyed on, so each line carries what
differs — grouped by dependency, that is the repositories waiting on it:

```
typescript:

* rubensworks/rdf-parse.js
* rubensworks/rdf-serialize.js
```

and grouped by repository, it is the dependencies that repository is waiting on:

```
CyclopsMC/forge-update-generator.js:

* typescript
* eslint
* actions/checkout
```

Grouped by owner or by update type, where both vary, each line carries both. Every pull request in
the group gets its own line, in the order it is shown in, so the list accounts for exactly as many
pull requests as the header counts. No links and no counts, so it pastes cleanly into an issue, a
chat message, or a prompt to a model. It needs no token scope and works with write actions off.

## View state lives in the URL

Grouping, sorting, filters and collapsed groups are kept in the **URL fragment**, so a view like
"everything failing, grouped by dependency" is bookmarkable and shareable. A fragment is never sent
to a server, so sharing a link never leaks anything.

## Keyboard shortcuts

| Key | What it does |
|---|---|
| <kbd>/</kbd> | Jump to the filter box |
| <kbd>r</kbd> | Refresh now |
| <kbd>g</kbd> | Toggle grouping by dependency |
| <kbd>Esc</kbd> | Dismiss a confirmation |

## Refreshing

The whole search re-runs every couple of minutes. Pull requests whose checks are still running are
re-read every thirty seconds instead — over REST, conditionally, because a `304 Not Modified` is
free where a GraphQL query never is. Requests are jittered so a batch does not arrive all at once.

Nothing polls while the tab is hidden: a dashboard nobody is looking at has no business spending
your rate limit. Polling slows down as the GraphQL quota drains and stops entirely before it runs
out, saying so in the footer rather than going quiet. A `403` or `429` is honoured with whatever
`retry-after` says.

Pin the tab and it becomes a passive monitor: the favicon takes the colour of the worst state and
the title carries the count — `(3✕) Renovate Overview` when three are failing.

## Rate limits

Everything goes over the REST API, because **GitHub's GraphQL endpoint does not support CORS** and
so cannot be called from a browser at all. One search finds the pull requests, then each one is
filled in from its own detail and checks, in small batches, with conditional requests throughout —
a `304 Not Modified` costs nothing against the rate limit, which is what makes polling affordable.
Remaining core and search quota are both shown in the footer; polling slows down as quota drains
and stops before it hits zero, saying so rather than silently freezing.

## Contributing

The suite runs entirely offline — Octokit is mocked at the `githubClient` module boundary and there
are no live network calls anywhere in `test/`. Coverage thresholds are set to 100% in
`vite.config.ts` and enforced in CI.

```bash
npm run lint && npm test && npm run build
```

## License

[MIT](LICENSE) © [Ruben Taelman](https://www.rubensworks.net/)
