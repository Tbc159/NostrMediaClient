# NostrMediaClient

**Live: <https://tbc159.github.io/NostrMediaClient/>**

A web client for **managing your own content on Nostr** — your media, your
articles, your calendar events — rather than for scrolling other people's.

Nostr clients mostly optimise for reading a feed. This one optimises for the
other side: getting something you made onto the network, in the right event
kind, on relays you chose, and being able to find it and correct it afterwards.
Every screen lists **only what you published**, and every publish reports what
each relay actually did with it.

> **Status: work in progress.** Everything in the table below works end to end
> and is covered by tests, against real relays and a Blossom server. What is
> _not_ there yet: reading other people's content, the outbox model (NIP-65),
> follow lists (kind 3), deletion requests (kind 5), direct messages, and any
> local caching — every page reload re-reads from the relays.
> [docs/PROGRESS.md](docs/PROGRESS.md) keeps the honest state of things,
> including the mistakes worth remembering.

## What it does today

| Area      | Kinds                   | What you can do                                                                                                        |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Notes     | 1                       | write, sign, publish                                                                                                   |
| Media     | 1, 20, 21, 22, 54, 1063 | upload to Blossom, then publish as a note with attachment, an image, a video, a podcast episode, or a catalogue record |
| Long-form | 30023                   | Markdown editor with preview, edit published articles in place                                                         |
| Drafts    | 31234, 10013            | encrypted drafts that follow you across devices (NIP-37), plus browser-local ones                                      |
| Calendar  | 31922, 31923, 31925     | date and time events with real timezone handling, RSVPs                                                                |
| Profile   | 0                       | edit your profile, loaded from relays before it is replaced                                                            |
| Viewing   | —                       | open any event in an external reading client, chosen per device                                                        |

Anything the client can publish, it can also list and — where the protocol
allows it — reopen and correct.

### Three things it deliberately does not hide from you

- **"Published" is not a single fact.** There is no transaction across relays.
  Every publish reports the outcome relay by relay, with the reason each one
  gave, instead of collapsing it into a green tick.
- **Not everything can be edited.** Notes and media are _regular_ events and are
  immutable by protocol. The client says so and offers to compose a new event,
  rather than pretending to edit one.
- **This is not a reading client.** To see a publication the way the rest of the
  network sees it, every card has an "Open in…" button pointing at a real
  reading client — noStrudel on a desktop, Primal on a phone, or anything else
  you paste a URL template for. The choice follows how you are interacting,
  not a setting you have to remember.
- **Your key never leaves your control.** A browser extension (NIP-07) signs
  without the key entering the page. A pasted private key is encrypted at rest
  with NIP-49 and lives in memory only until you reload.

## Requirements

- **Node.js 22.12 or newer** — Vite 8 will not run on older versions
- **pnpm 11 or newer**
- A modern browser

The repository pins both: [`.nvmrc`](.nvmrc) and the `packageManager` field in
[`package.json`](package.json).

## Installation

```bash
git clone https://github.com/Tbc159/NostrMediaClient.git
cd NostrMediaClient
pnpm install
cp .env.example .env      # then edit it, see below
```

### Configuration

Every endpoint is a **first-run default, never a dependency**: the client must
stay fully usable pointing somewhere else. Copy `.env.example` to `.env` and
fill it in.

| Variable                              | What it does                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `NUXT_PUBLIC_DEFAULT_READ_RELAYS`     | where feeds, calendar, articles and media are read from                                                                  |
| `NUXT_PUBLIC_DEFAULT_WRITE_RELAYS`    | publish targets, tried **in the order you list them**                                                                    |
| `NUXT_PUBLIC_INDEXER_RELAYS`          | used to resolve other people's profiles and relay lists                                                                  |
| `NUXT_PUBLIC_DRAFT_RELAY`             | one private relay for encrypted drafts. Leave empty to keep drafts browser-only — there is no fallback to a public relay |
| `NUXT_PUBLIC_DEFAULT_BLOSSOM_SERVERS` | media servers, first is primary and the rest receive mirrors                                                             |
| `NUXT_PUBLIC_SITE_URL`                | public URL of the client, for canonical links and Open Graph                                                             |

`.env` is git-ignored and must stay that way: it holds pointers to your own
infrastructure. **Do not put private endpoints in `.env.example`** — that file
is published.

All of these can also be changed from **Settings** inside the running client,
without a restart. Those choices live in that browser, not in the repository.

A Blossom server has one non-obvious requirement: it must send CORS headers on
the **actual response**, not only on the `OPTIONS` preflight, or the browser
blocks the upload. Use `pnpm check:endpoints` to find out before you rely on it.

### Running it

Three ways, for three situations.

```bash
pnpm dev          # foreground, with hot reload — normal development
pnpm start        # background, survives closing the terminal
pnpm build        # production build of the packages and the Nuxt app
```

`pnpm start` and friends wrap [`scripts/client.sh`](scripts/client.sh), which
also loads Node from nvm if it is not on your `PATH`:

| Command                     | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `pnpm start`                | start in the background and report the URL                               |
| `pnpm stop`                 | stop it, freeing the port even if the process is orphaned                |
| `pnpm restart`              | stop and start — needed after editing `.env`, which is read only at boot |
| `pnpm status`               | whether it is running, plus the configuration in effect                  |
| `pnpm logs`                 | follow the server log                                                    |
| `./scripts/client.sh fg`    | run in the foreground instead                                            |
| `./scripts/client.sh check` | probe every configured relay and Blossom server                          |

The client is then at <http://localhost:3000>.

### Publishing it as a static site

The client is entirely client-side, so it runs on any static host. A GitHub
Pages workflow is included and publishes `main` automatically.

```bash
NUXT_APP_BASE_URL=/YourRepoName/ pnpm build:pages
```

The output lands in `apps/web/.output/public`. Two details make the difference
between a build that works and one that looks broken:

- **The base URL must match the subfolder** the site is served from. GitHub
  Pages project sites live under `/<repo>/`, and an absolute `/` would ask for
  the bundles at the domain root.
- **`404.html` is the SPA fallback.** GitHub Pages serves it for any unknown
  path, which is how a direct link to a subpage keeps working. The
  `github-pages` Nitro preset generates it, along with `.nojekyll`.

Without a `.env` the client falls back to public relays and Blossom servers, so
a fresh deployment is usable immediately. The draft relay stays empty on
purpose — encrypted drafts need a relay you control.

One thing a static host cannot do: **server-rendered Open Graph previews**.
Sharing a link to a specific event will not produce a rich preview. That needs
a Node host, and it is the only reason to prefer one.

### Development scripts

```bash
pnpm verify        # everything below, in order — run this before committing
```

| Script                              | What it checks                                           |
| ----------------------------------- | -------------------------------------------------------- |
| `pnpm guard:deps`                   | that no duplicate or mispinned Nostr dependency crept in |
| `pnpm format` / `pnpm format:check` | Prettier                                                 |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                                   |
| `pnpm typecheck`                    | TypeScript across every package and the app              |
| `pnpm test`                         | unit and relay integration tests                         |
| `pnpm check:endpoints`              | reachability of the relays and Blossom servers in `.env` |

The integration tests start a **real minimal relay in-process** rather than
mocking the pool, so rejections, silences and addressable replacement are
exercised over an actual WebSocket. Nothing is ever published to public relays
by the test suite.

Where a claim is about privacy — encrypted drafts, for instance — the test
inspects what the relay actually stored, rather than trusting that the encrypt
call was made.

## How the code is arranged

```
packages/nostr-core   isomorphic domain: kind registry, relays, media, drafts, keys
packages/nostr-vue    Vue composables over the core
apps/web              the Nuxt 4 application
```

`nostr-core` never touches `window`, `document` or `localStorage` — a lint rule
enforces it — so it runs identically in the browser and during SSR.

**Adding support for a new event kind means adding one file** to
`packages/nostr-core/src/kinds/definitions/` and registering it. Nothing else
needs to change: it appears in the lists, gets rendered, and becomes publishable
on its own. That is the point of the whole structure.

## Security notes

- The signer, the relay pool and any key material are **client-only**. SSR
  covers public data exclusively, because Nuxt serialises server state into the
  HTML.
- A decrypted private key lives in a module variable outside the store, so it
  cannot be serialised into the SSR payload or inspected in devtools. Reloading
  the page locks it again.
- Encrypted drafts (NIP-37) are unreadable on the relay, but the relay still
  sees _when_ you write. Use a private relay for them.

## Licence

**[PolyForm Noncommercial 1.0.0](LICENSE.md).** Free for personal use, hobby
projects, research, education, charities and public institutions. Commercial use
needs a separate agreement — which is an invitation to talk, not a refusal.

See **[COMMERCIAL.md](COMMERCIAL.md)** for what that covers, why the licence is
not MIT, and what actually helps the project.

This is not an OSI-approved open source licence, because it restricts a field of
use. That trade-off is deliberate and explained in the same file.

## Contact and support

- **Issues and commercial enquiries**:
  <https://github.com/Tbc159/NostrMediaClient/issues>
- **On Nostr**: `npub…` <!-- fill in with your npub -->
- **Zaps**: `you@example.com` <!-- fill in with your Lightning address -->

If this saved you time, the most useful thing you can send back is a bug report
from a relay or Blossom server that behaves unlike its specification. Most of
what is solid in this project came from exactly that.
