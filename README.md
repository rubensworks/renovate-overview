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

> **Status:** in development. Paste a token and you get the whole backlog: every open Renovate pull
> request across your account and your organisations, grouped by dependency or by repository,
> sorted and filtered however you like, with the view in the URL so you can bookmark it. The bulk
> actions land in the milestones described in [`CLAUDE.md`](CLAUDE.md).

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
- **Actions: Read and write** — only needed for "re-run failed jobs".

### Where the token is stored

- Main token: `localStorage` under `renovate-overview:token`, or `sessionStorage` if you tick
  "don't remember me".
- Organisation tokens: `renovate-overview:owner-tokens` in the same storage.

Signing out clears both storages. A stored token is never rendered back into the page.

## View state lives in the URL

Grouping, sorting, filters and collapsed groups are kept in the **URL fragment**, so a view like
"everything failing, grouped by dependency" is bookmarkable and shareable. A fragment is never sent
to a server, so sharing a link never leaks anything.

## Rate limits

The dashboard uses one GraphQL search to fetch the PRs *and* their check rollups together, rather
than walking repositories one by one, and refreshes pending checks over REST with conditional
requests — a `304 Not Modified` costs nothing against the REST limit. Remaining REST and GraphQL
quota is shown in the footer; polling slows down as quota drains and stops before it hits zero,
saying so rather than silently freezing.

## Contributing

The suite runs entirely offline — Octokit is mocked at the `githubClient` module boundary and there
are no live network calls anywhere in `test/`. Coverage thresholds are set to 100% in
`vite.config.ts` and enforced in CI.

```bash
npm run lint && npm test && npm run build
```

## License

[MIT](LICENSE) © [Ruben Taelman](https://www.rubensworks.net/)
