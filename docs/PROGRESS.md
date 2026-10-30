# Progress

Pick-up file: it says where we are, what is missing and how to put the
environment back on its feet. It is updated at the end of every block of work,
not at the end of a phase — the point of it is surviving interruptions
half-way through.

---

## Restoring the environment (do this in every new shell)

Node and pnpm live under nvm and are **not** on the default PATH: the system
shell still has Node 18, which is not enough (Vite 8 requires >= 20.19).

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22; hash -r
node -v   # expected v22.23.2
pnpm -v   # expected 11.23.0
```

### Running the client

`scripts/client.sh` loads nvm by itself: **these commands work in any shell**,
with no manual preparation.

```bash
pnpm start            # starts in the background, back at the prompt in ~10s
pnpm status           # status + the configuration currently read from .env
pnpm restart          # restart: needed after EVERY change to .env
pnpm stop             # stop
pnpm logs             # follow the log (Ctrl-C to quit)

./scripts/client.sh start 3210   # a different port
./scripts/client.sh fg           # foreground, Ctrl-C to quit
./scripts/client.sh check        # probe endpoints from Node (no CORS)
```

The server reads `.env` **only at startup**: changing it while running has no
effect, you need `pnpm restart`. Verified experimentally.

State and logs live in `.run/` (git-ignored). If the PID file goes missing,
`stop` still closes whatever is holding the port.

### Verifying the repo

```bash
pnpm guard:deps        # dependency traps (ADR 0002)
pnpm check:endpoints   # probe relays and Blossom from Node (no CORS)
pnpm verify            # guard + format + lint + typecheck + test
pnpm build             # packages + Nuxt app
```

Note: the script is called `check:endpoints` and not `doctor` because
`pnpm doctor` is a built-in pnpm command and would take precedence.

---

## Phase 0 — monorepo scaffolding · COMPLETE

| #   | Task                                                    | Status               |
| --- | ------------------------------------------------------- | -------------------- |
| 1   | Node 22 LTS through nvm                                 | done — v22.23.2      |
| 2   | pnpm through corepack                                   | done — 11.23.0       |
| 3   | `git init` on branch `main`                             | done — no commit yet |
| 4   | Root: `package.json`, `pnpm-workspace.yaml`, `.npmrc`   | done                 |
| 5   | `tsconfig.base.json`, prettier, `eslint.config.js`      | done                 |
| 6   | `.gitignore`, `.env.example`                            | done                 |
| 7   | `scripts/guard-deps.mjs` + a check that it really fails | done                 |
| 8   | ADR 0001 / 0002 / 0003                                  | done                 |
| 9   | `packages/config` — tsconfig presets                    | done                 |
| 10  | `packages/nostr-core` — kind registry + config          | done                 |
| 11  | `packages/nostr-vue` — `useModel`                       | done                 |
| 12  | `apps/web` — Nuxt 4 + Tailwind 4                        | done                 |
| 13  | `.github/workflows/ci.yml`                              | done                 |
| 14  | `pnpm verify` and `pnpm build` green                    | done — 29 tests pass |

### What already works and has been verified

- `pnpm verify` green end to end: guard, prettier, eslint, typecheck across
  the three projects, 29 tests.
- `pnpm build` produces the Nitro output; the built server answers 200 and
  serves the Tailwind CSS.
- **The dependency guard was proved in the negative**: introducing
  `applesauce-factory` or widening the `nostr-tools` range makes the script
  exit 1 and explain why. It is not a check nobody has ever seen fail.
- **SSR isolation is already observable**: the `/` route (personal feed) is
  `ssr: false`, and the HTML served contains `data-ssr="false"` with
  `__NUXT_DATA__` reduced to `[{"serverRendered":1},false]`. No session state
  in the payload, which is the property section 4 of the plan asks for.

### Departures from the plan, decided while executing it

| Point                              | Plan      | Reality         | Why                                                                                                  |
| ---------------------------------- | --------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| pnpm                               | `pnpm@10` | `pnpm@11.23.0`  | the current line; the `onlyBuiltDependencies` key became `allowBuilds`                               |
| `@nuxt/test-utils`                 | —         | `^4.1.0`        | 3.x wants Vitest 3, we are on Vitest 4                                                               |
| `consistent-type-imports` rule     | planned   | **not enabled** | redundant: `verbatimModuleSyntax` already has the compiler enforce the same thing (TS1484), for free |
| `no-undef` on `.vue` files         | —         | disabled        | it trips over Nuxt auto-imports; `nuxt typecheck` stays the authority, as it already does for `.ts`  |
| `types: ["vite/client"]` in preset | planned   | removed         | library packages do not have Vite among their dependencies                                           |

---

## GUI phase (branch `webapp/gui`) — screens and forms · IN PROGRESS

Done and verified in the browser (headless Firefox through WebDriver):

For the current list of screens see «Available sections» below.

**The forms produce real events** and hand them to the configured relays.

### Publishing to and reading from relays

Added under `nostr-core/src/relays/`: `pool.ts` (the `RelayPool` factory),
`publish.ts` (sending, with a per-relay outcome), `request.ts` (reading,
deduplication, ordering).

**There is no such thing as "published" in the absolute.** There are relays
that have the event and relays that do not: no transaction, no rollback. So
the outcome is a per-relay list, and the UI shows it as it is instead of
reducing it to a boolean that would hide half the truth. The success threshold
is **one** relay: an event present on a single relay is still reachable and
replicable, whereas demanding unanimity would fail every publication whenever
one relay is down.

Three non-obvious points, all covered by tests:

1. **It is the OK boolean that says whether the event was accepted, not the
   prefix.** NIP-01 shows `pow:` and `duplicate:` on positive responses too:
   reading only the prefix would report a successful publication as failed.
2. **`duplicate` is a success.** The relay already has it: for the publisher
   the result is identical to an acceptance. Publishing again duplicates
   nothing.
3. **A relay that demands NIP-42 leaves the publish _pending_**, it does not
   refuse it. Without an explicit deadline the button would spin forever; with
   one you reach a message that says what to do.

**NIP-42 authentication is used only for writing, never for reading.** When
you hand a relay an event already signed with your key, authenticating reveals
nothing new to it. Doing it while reading would instead tell it _what you read
and when_, which is information it has no reason to have.

For reading the opposite rule applies to failure: a relay that does not answer
does not make reading from the others fail — you get back whatever arrived
before the deadline. A feed with three notes out of five is useful, one in
error is not.

Events that are read go through `ultimaVersione()`: different relays can hold
different versions of the same addressable event, and without that step the
same meeting would appear twice in the calendar, once with the old title and
once with the new one. The tie-break at equal `created_at` is the lower id, as
NIP-01 prescribes — that is not aesthetics, it is what makes different clients
converge on the same version.

The calendar sorts by **event date**, not by publication date: in a calendar
what matters is when the event happens, not when it was written.

### Available sections

| Route              | Kinds                   | What it does                                             |
| ------------------ | ----------------------- | -------------------------------------------------------- |
| `/`                | all                     | your events, with a filter by type                       |
| `/scrivi`          | 1                       | composer, sign and publish                               |
| `/media`           | 1, 20, 21, 22, 54, 1063 | your media                                               |
| `/media/nuovo`     | same                    | Blossom upload, preview, `imeta`, publication            |
| `/articoli`        | 30023, 30024            | your articles, with local and encrypted drafts           |
| `/articoli/nuovo`  | 30023                   | formatted editor, with the Markdown a button away        |
| `/calendario`      | 31922, 31923            | your events, split into upcoming / already held          |
| `/calendario/rsvp` | 31925                   | answer an invitation or change your answer               |
| `/profilo`         | 0                       | your profile, loaded from the relays before replacing it |
| `/impostazioni`    | —                       | sign-in, editable endpoints, publication strategy        |
| `/diagnostica`     | —                       | probe relays and Blossom servers                         |

The `/` screen shows **every kind the client can publish**, with per-type
filters and their counts. The list comes from `publishableKinds()` and not
from a hand-written array: registering a new kind makes it appear there
without touching the page, which is the whole point of the kind structure.

**Ephemerals** stay out, and not out of caution: NIP-01 tells relays not to
keep them, so querying would always come back empty. Blossom's kind 24242 is
the example — it is signed and sent, but inside an HTTP header.

The filter works on what has already been read, without going back to the
relays: the events are all on the page already, and a second query would add
waiting in order to show a subset.

### Reopening a published event for editing

Every card in a list carries, at the bottom, the right action for its kind,
and the distinction is not "which kind" but the NIP-01 **class**, which the
registry already knows:

| Class                       | Kinds                     | Action offered                      |
| --------------------------- | ------------------------- | ----------------------------------- |
| `replaceable`/`addressable` | 0, 30023, 31922/23, 31925 | **Edit**: it really replaces        |
| `regular` with media        | 20, 21, 22, 1063          | **Republish as new**, with a notice |
| `regular`                   | 1                         | none, with the explanation why      |

The point the plan forbids us to blur: on `regular` events **editing does not
exist**. That is not a limitation of this client — the protocol does not
provide for replacement, and the only possible thing is a new event, with a
different id and without the reactions the old one received. For media,
though, the files are not uploaded again: they are already on Blossom,
identified by hash, and the old event's `imeta` holds everything needed.

Three details the tests protect:

1. **The identifier is not regenerated.** It is the `d` tag, and it is what
   makes republishing a replacement. Regenerating it would leave the original
   lying around and create a second one.
2. **The timezone is rebuilt from the event's, not from the editor's.**
   Reopening from Rome a meeting set in Tokyo, the fields show the time the
   organiser wrote.
3. **The profile (kind 0) must be loaded before republishing it.** It is
   replaceable and replaces in full: a field left empty does not stay as it
   was, it disappears. The screen says so in plain words.

The action only appears on your own events — every coordinate includes the
author's pubkey, so "editing" someone else's would produce a new event under
your own name. The exception is «Answer the invitation» on calendar events,
which is precisely about other people's.

**A defect fixed as a consequence:** «Edit» on a published article did nothing
if no local draft with that identifier existed. Now the local draft takes
precedence — it is the work not yet published — and in its absence the version
is downloaded from the relays.

**Every list shows only the active identity's events.** That is a choice, not
a temporary limitation in disguise: without the follow list (kind 3) and
without the outbox model (NIP-65), a list "of everyone" would be _whatever
comes through the configured relays_ — an arbitrary slice of the network,
different on every reload. Your own events are a set the user recognises.

### The failure with NIP-07 extensions (nos2x, Alby)

The symptom observed while signing with nos2x:

```
Failed to execute 'postMessage' on 'Window': #<Object> could not be cloned.
```

It looks like a failure of the extension and it is not. NIP-07 extensions **do
not live in the page**: the injected code passes the event to its own content
script with `window.postMessage`, which copies the object using the
**structured clone**. The structured clone refuses `Proxy` objects, and a
template composed in a form lives inside a `ref`, which in Vue wraps whatever
you put in it in a reactive proxy. Signing therefore failed _before_ the
extension ever saw it.

The remedy: `plainEventTemplate()` in `nostr-core/src/identity/keys.ts`,
applied in `identity.ts` before handing the template to whoever signs. The
rebuild is explicit — it says what the extension receives, it does not tie the
domain to Vue, and it copies the tags too, which are nested arrays: flattening
only the outer level would leave proxies deeper down.

Verified in both directions: putting the defect back makes the browser test
reproduce it (Firefox is even more explicit — «Proxy object could not be
cloned»), and with the fix it passes.

**A nearby defect, found as a consequence:** `estensioneDisponibile` was a
`computed` with no reactive dependencies, so it was evaluated once only.
Extensions inject `window.nostr` asynchronously and can arrive after the
application has started, leaving the user looking at «no extension detected»
which a reload contradicts. It is now a `ref`, re-checked at startup with a
few close attempts, and again when the settings page opens.

### Encrypted drafts (NIP-37)

Kind 31234: an **unsigned** event of another kind, serialised and NIP-44
encrypted towards your own key. The content is not signed — it is work in
progress, and signing it would produce a final id for something that will
change again. The signature is carried by the wrapper.

The encryption lives in `drafts/`, **outside the kind definitions**, for two
reasons: `build()` is synchronous by contract while with NIP-07 encryption
goes through a `Promise`, and the registry describes formats and owns no keys.
As far as the definition is concerned the `content` is an opaque string.

Three non-obvious points:

1. **An empty `content` means a deleted draft**, not an empty one. The
   specification says so, and it is the only way to delete one without hoping
   a relay honours a kind 5 request.
2. **The `d` tag is not encrypted.** It is the only way the relay can know
   which version to replace, so deriving it from the title would defeat half
   the work: the content would stay unreadable but anyone with access to the
   relay would know what you write about. It is a 16-character hash of the
   real identifier — deterministic, so saving again replaces, and opaque. The
   real identifier lives inside the encrypted content, and the list shows the
   title by decrypting it.
3. **The NIP-40 expiration authorises the relay to delete.** Ninety days as
   the specification recommends, shown in the interface: a draft that
   disappears silently would be worse than one never saved.

The cipher covers the three sign-in modes: `window.nostr.nip44` with the
extension, local derivation with the key in memory, nothing in read-only. An
extension that does not expose NIP-44 says so instead of failing.

Kind **10013** declares the private relays, also encrypted in the content and
not in the tags: knowing where somebody keeps their drafts is already
information. If it exists it takes precedence over the configured relay; there
is **never** a fallback to the public write relays.

Verified by querying the relay after saving: all that remains is
`["d","<hash>"]`, `["k","30023"]`, the expiration and the encrypted text.

### Endpoints editable from the interface

The `.env` endpoints stay what the plan says they are — first-run defaults —
and from `/impostazioni` they can be replaced without restarting the client.
The choice lives in `localStorage`, so in that browser and not in the
repository.

The override happens on the **raw** shape of the environment and not on the
already validated object: that way validation stays the single one in
`resolveClientConfig`, shared between app, SSR and command line. Saving is
all-or-nothing — accepting the valid changes and discarding the others would
leave a half configuration, different from the one written, with nothing
saying so.

### Publishing by rotation

With several write relays the client now tries them **one at a time, in order,
stopping at the first that takes the event on**. Configurable: the parallel
strategy stays available in the settings.

The reason rotation is the default is measured, not theoretical: opening four
WebSockets at once, some of them fail, while one at a time they get through.
The trade-off has to be said: by rotation the event ends up on **one** relay,
so it is less reachable; in parallel it ends up everywhere, but it fails more
often.

Relays that were not contacted appear in the result marked as such, and do not
enter the count: otherwise a publication that went exactly as intended would
read «1 out of 4».

**A defect fixed in the meantime:** a WebSocket connection error turned into
the message `[object ErrorEvent]`. rxjs propagates the DOM event, not an
`Error`, and the useful fields have to be pulled out by hand — `CloseEvent`
carries the code, `ErrorEvent` the message.

### Media (Blossom)

`packages/nostr-core/src/media/blossom.ts` covers BUD-01/02/04/11. The SHA-256
hash is computed **in the client before sending** and travels in `X-SHA-256`:
a `409` says what arrived is not what was sent, something you would otherwise
discover only on seeing the broken image in the published post.

The BUD-11 token (kind 24242) is ephemeral and **never ends up on a relay**:
it lives in the `Authorization` header, base64url without padding. It lasts
five minutes, because a token without a `server` tag is spendable on any
Blossom server until it expires.

Mirroring to the other servers does not block: if it fails, the file stays on
the primary. Treating it as an error would throw away a successful upload
because a _secondary_ server did not answer.

The invariant holds: **if the upload fails, nothing is published**. An `imeta`
pointing at nothing stays published forever, and kind 20 is regular, so it
cannot be corrected.

### Which kind to publish a medium with

Six ways, and the choice **changes who will see the post**, not how it looks.
It is the least intuitive point in the whole section:

| Mode                 | Kind   | Who shows it                                                              |
| -------------------- | ------ | ------------------------------------------------------------------------- |
| Note with attachment | 1      | **any social client** (NIP-92 `imeta`)                                    |
| Image / gallery      | 20     | clients dedicated to images (NIP-68)                                      |
| Video / short video  | 21, 22 | video clients (NIP-71)                                                    |
| Podcast episode      | 54     | podcast players (NIP-F4)                                                  |
| File record only     | 1063   | **almost nobody**: NIP-94 says social clients are not required to show it |

The default is the **note with attachment** for audio and for everything that
is not an image or a video. A default that publishes something nobody shows
would be a trap, and that is exactly what it did before, falling back to 1063.

Labels corrected as a consequence: «Image gallery» becomes «Image» when there
is a single file, and «File record» becomes «File record only» with what it is
actually for written next to it — indexing, not showing.

**Audio.** In the NIP index there is no generic kind for a track or an audio
file: the only standardised one is **NIP-F4's kind 54**, the podcast episode.
Anyone who just wants to share some audio uses the note with attachment.

Two peculiarities of NIP-F4 that the interface states:

1. **The podcast is the key itself.** Episodes are signed directly by the
   podcast's key, with no intermediate layer: publishing a kind 54 with your
   personal identity makes that identity _become_ the podcast. The show card
   (kind 10154) is composed from the profile, for the same reason.
2. **Audio is declared with an `audio` tag, not with `imeta`.** No hash and no
   size: a listener cannot verify that the file is the one that was published.
   The specification wants it that way.

The note with attachment puts the URL **in the content as well**, because
NIP-92 says every `imeta` should correspond to a URL in the text: clients look
for the address there and replace it with the preview. An attachment declared
only in the tag would be shown by nobody.

### The media flow, in three moments

Revised: **choosing is not uploading, and uploading is not publishing.**
Before, the file left for Blossom as soon as it was selected. It seemed faster
and it was not: it sent to a remote server a file the user had not yet looked
at, and **from Blossom there is no real way back** — the blob is identified by
its hash, and whoever knows it can download it again even after a deletion.

1. **Choice** — preview and measurements, all in the browser. The preview is a
   local `blob:`, not a remote URL: it is the visible proof that nothing has
   left.
2. **Options** — closed by default. Accessible description per file, title,
   description, hashtags, kind, content warning: all in one pass, and only if
   needed. Touching nothing publishes a gallery with no title.
3. **Upload** — on explicit confirmation, with the destination server written
   out.
4. **Publication** — a separate and **optional** step: the file stays
   reachable from its address even without any event, and the screen says so.

State is per file, not global: if one upload out of three fails, the other two
stay on Blossom and only the failed one is retried.

Verified by querying the Blossom server, not the interface: after choosing,
the upload attempt counter is still at zero.

### Long-form (NIP-23)

A formatted editor, with the Markdown source one button away. Two things the
specification says and the code enforces:

- **no HTML inside the Markdown** — `build` refuses it;
- **`created_at` is the last edit, `published_at` the first release**.
  Updating the second on every save would push the article back up other
  people's feeds at every correction.

Rendering always goes through DOMPurify. The ban on HTML binds _whoever
writes_, not whoever reads: an event arrives from a relay that does not
enforce it.

**Two kinds of draft**, with different trade-offs, both stated in the
interface:

- **in this browser** (`localStorage`): it does not leave, but it does not
  follow you to another device;
- **encrypted on the relay** (NIP-37, kind 31234): it follows you everywhere
  and stays unreadable on the relay. In exchange it needs a key able to
  encrypt — read-only is not enough — and the relay still sees _when_ you
  write.

Kind 30024, which NIP-23 declares deprecated, would end up on the relay _in
the clear_: calling it a draft was misleading. It stays registered read-only,
so as not to make texts written with other clients disappear.

### Identity — how it behaves

Three modes: NIP-07 extension (recommended), NIP-49 encrypted private key,
read-only. The decrypted key lives in a **module variable, outside the store's
state**: it is not reactive, it does not show up in the devtools and it cannot
end up in the SSR payload.

An intended and verified consequence: navigating between pages the key stays
unlocked, **a full reload locks it again** and asks for the password.

### A review against NIP-52

A re-read of the current specification. Four departures corrected:

1. **Missing `D` tag** — mandatory for kind 31923: the daily index
   `floor(unix_seconds / 86400)`, with one tag per day covered. It does **not**
   apply to 31922, where the specification lists only `start` and `end`.
2. **`location` is repeatable**: a meeting can have both an address and a link
   to the video call.
3. **`p` carries a relay and a role** in third and fourth position, not just
   the pubkey.
4. **`end` must be compared strictly**: the specification says «start must be
   less than end», so an end equal to the start has to be refused.

The `a` tag towards calendars (kind 31924) was added too.

A note on the `D` tag: it is anchored to UTC, because the formula uses only
the timestamp. An event at 23:00 in Tokyo therefore falls on the previous UTC
day. Bringing the timezone into the calculation would produce indices
incompatible with other clients.

### Bugs only the browser test found

Three defects got past both `nuxt typecheck` and eslint, which is why the
end-to-end test cannot be replaced by the static ones:

1. **`BaseButton` with `to` was inert.** `<component :is="'NuxtLink'">` does
   not resolve the component and produces a literal `<nuxtlink>` element, with
   no href and no navigation. Every link-button was dead. It needs
   `resolveComponent('NuxtLink')`.
2. **An invalid template expression.** A `@click` with two statements on
   separate lines, and an `as const` inside a `v-for`: Vue template
   expressions are plain JavaScript, not TypeScript. The settings page did not
   load at all.
3. **The calendar form started out invalid.** Turning on "all day" left the
   end date equal to the start date, which NIP-52 refuses because the end is
   exclusive. It now moves to the following day.

---

### How publishing is tested without writing to public relays

`test/helpers/relay-finto.ts` starts a minimal in-process NIP-01 relay (with a
system-assigned port, so the tests run in parallel). It is not a mock of the
pool: the traffic really goes through a WebSocket and real NIP-01 messages,
which is the only way to see the cases that matter — refusals, silences,
replacement of addressables. A mock would only prove that our code calls
itself.

It also keeps test events off the public relays.

---

## Moving a podcast from another host (branch `feature/migrazione-podcast`) · DONE, NOT MERGED

The goal: a podcast born on Spotify for Creators (or any host) moves to NMC
without losing episodes, order, identity or listeners, and lands on a feed
address its creator owns. The analysis was done on the real test feed
`https://anchor.fm/s/117e26658/podcast/rss`; the design is in
[`docs/PODCAST.md`](PODCAST.md), «Stable address and moving from another
host». The branch stays unmerged until it has been tried by hand: `main` has
real users.

| Stage | Content                                                                                                        | Commit    |
| ----- | -------------------------------------------------------------------------------------------------------------- | --------- |
| 1     | Data model: NIP-73 identities, `published_at`, numbering, Podcasting 2.0 tags, kind 10002; Prompt K            | `35c9bf0` |
| 2     | Reading other hosts' feeds, the parity comparison, BUD-06 pre-upload question                                  | `1e38289` |
| 3     | The import: preview, `podcast:locked`, Blossom copies with a 2 GB limit and batches, reruns without duplicates | `9e87de4` |
| 4     | Which key: the question, the dedicated key, saved identities and «Cambia identità»                             | `25718d8` |
| 5     | The stable address: the gate on the URL, the intermediary's check, managed domains as «coming soon», NIP-98    | `e153aaf` |
| 6     | Parity check before the redirect; platforms where the show already is, YouTube's start date                    | `e9f41c0` |
| 7     | This documentation, Prompts L and M                                                                            | `bd7f00c` |

### How it was verified

- **Unit tests** for every core piece: the UUIDv5 vectors, the tags' build and
  parse, the three fixtures (the real Anchor feed, a complete synthetic one, a
  locked one), the comparison, the subdomain and domain rules, NIP-98.
- **Five browser runs**, headless Firefox through WebDriver, against local
  fakes only — a NIP-01 relay, a Blossom server that answers 413 above a set
  size, the old host serving the fixtures, a feed service that behaves as
  Prompt K asks, three intermediaries (correct, without CORS, a 301) and the
  managed-domain endpoints checking NIP-98. Nothing was published to a public
  relay. They cover the import with both file choices, the locked feed, the
  card already on a key (distributed and not), the dedicated key end to end,
  switching identities, the address gate, the managed modes with the switch
  off and on, the parity check and the platforms. The fakes and the drivers
  were throwaway tools and are not in the repository.
- **A sixth run**, after the manual test plan had found three paths that went
  wrong. It covers resuming the import on the same show when its card links
  to Spotify, a card made by hand with the show's own links (both answers to
  the new question), and the show's page on Spotify and Apple pasted instead
  of the feed.

### What is waiting, and on whom

1. **Prompts K and N are deployed** on the media-manager (service commits
   `b76aa41` and `c76307e`, 30 October 2026). The feed carries the show's
   identity, pages through each relay, keeps one item per episode and cuts by
   `published_at`, up to 1000 episodes.
2. **The manual tests, done by the user** on their own relay
   (`wss://21milionidinostr.duckdns.org`) with one of the default Blossom
   servers. They follow four creators' stories: no podcast yet; a show on one
   platform; a card in the person's own name; an account made for the show.
   Each story runs on a real podcast. Two of those shows still have to be
   created on other hosts, and the platforms take days to approve them. The
   redirects on the old hosts come last, one show each, and are the user's
   decision.
3. **The NMC domain**, for Prompts M then L. The client side is ready: the
   operator turns on `NUXT_PUBLIC_FEED_DOMINI_GESTITI` and moves
   `NUXT_PUBLIC_MEDIA_MANAGER_URL` to `api.<NMC domain>`.

## Relays and Blossom servers follow the key (same branch) · DONE, NOT MERGED

The endpoints chosen in the settings were per browser, while the
configuration comments promised a sync through kinds 10002 and 10063. Now
`stores/sincronizzazione.ts` reads both lists whenever an identity becomes
active and takes them unless something newer was chosen here, with that key;
the settings card «Relay e server Blossom sul tuo account» shows each list's
state and publishes on request, after a preview. What only this device can
reach (localhost, private networks, no TLS) never goes into a public list and
stays in the device's endpoints. The pure logic is in
`packages/nostr-core/src/config/liste.ts`; kind 10063 is
`blossomServersDefinition`.

Verified with 25 unit tests and a browser run against the local fakes (the
«public» relays and servers were `.invalid` names, which never resolve): a new
browser takes the published lists and keeps its own local relay; a change made
here survives a reload; publishing shows the preview, leaves the local relay
out, keeps another client's tag and replaces the old version; «Usa quelli
pubblicati» brings the list back without publishing; a second key without
lists changes nothing until its server list is published; with only local
addresses there is nothing to publish; switching back to the first key brings
its lists back, since the change was made with the other one. The four earlier
runs (import, key, address, platforms) were run again.

Two more fixes on the branch, found while doing this:

- the stray spaces before punctuation, everywhere, through a template compiler
  transform (`apps/web/compiler/punteggiatura.ts`): 57 in the compiled
  templates before, none after;
- the `podcast:guid` of a card the feed had already served is inherited from
  that feed when a stable address is added, instead of being computed from the
  new address.

---

## Next step: the rest of Phase 1

Done in this round: `relays/` — pool, publishing with a per-relay outcome,
reading with deduplication. Still missing:

1. `relays/` — the NIP-65 outbox resolver (kind 10002) and NIP-11 reading in
   the pool. Until that exists, "everyone" in the feed means _whatever comes
   through the configured relays_, not the whole network: the UI says so
   instead of implying a coverage it does not have.
2. `store/` — `applesauce-core`'s EventStore with a Dexie cache client-side.
   Today every page change re-reads from the relays: it works, but it is
   wasted traffic.
3. `signers/` — NIP-46 bunker (NIP-07 and NIP-49 already done).
4. The remaining `kinds/definitions/`: 3 (follows), 5 (deletion). Kinds 10002
   and 10063 exist, read at login and published from the settings; the outbox
   resolver in point 1 still does not.
5. `nostr-vue`: `useAccount`, `useProfile`, `useEvent` — `useTimeline` lives in
   `apps/web` for now, to be promoted when more than one app needs it.

The registry (`kinds/registry.ts`) and its invariants are ready and covered by
tests: definitions hook into it with no other changes.

---

## Later phases (from the plan)

| Phase | Content                                                                                 |
| ----- | --------------------------------------------------------------------------------------- |
| 2     | NIP-07/46 auth, profile (0), follows (3), relay list (10002 + migration from 2)         |
| 3     | Feed: notes (1), reposts (6/16), reactions (7), comments (1111), composer, deletion (5) |
| 4     | Media: Blossom BUD-01/02/06, imeta, kinds 20/21/22/1063                                 |
| 5     | Long-form 30023/30024, Markdown editor, SSR + Open Graph + RSS                          |
| 6     | Calendar 31922-31925, RSVP, timezones                                                   |
| 7     | DMs: reading kind 4 + sending NIP-17 (1059/13/14) + relay list 10050                    |
| 8     | PWA, i18n, accessibility, hardening                                                     |

Payments stay **outside v0**: see Appendix A of the plan.

---

## Endpoint configuration — verified from the browser

`.env` lives in the **monorepo root**, not in `apps/web`. Nuxt would not find
it by itself: the `dev`/`build`/`preview` scripts in `apps/web` therefore pass
`--dotenv ../../.env`. Without that flag the runtimeConfig stays empty and the
diagnostics show the wrong endpoints.

Two tools, **one single piece of logic**
(`packages/nostr-core/src/relays/probe.ts`, isomorphic): CLI and browser give
the same diagnosis by construction.

```bash
pnpm check:endpoints            # from Node, CORS does not apply
pnpm dev  →  /diagnostica       # from the browser, CORS applies as in the real app
```

Outcome: **8 endpoints out of 8 reachable**, verified from the browser with
headless Firefox driven through WebDriver.

The page shows the time of the last check next to the summary: without it, a
tab left open shows old results indistinguishable from fresh ones, and after a
`restart` it looks as though an endpoint has gone down when it is only the
page that is stale.

| Endpoint                        | Role            | Notes                                        |
| ------------------------------- | --------------- | -------------------------------------------- |
| `wss://relay.damus.io`          | read, write     | **intermittent**, per-IP rate limit          |
| `wss://nos.lol`                 | read, write     | stable, ~200 ms                              |
| `wss://relay.primal.net`        | read            | declares NIP-22                              |
| `wss://purplepag.es`            | indexer         | declares NIP-42                              |
| `wss://user.kindpag.es`         | indexer         | declares NIP-22                              |
| `https://blossom.yakihonne.com` | media (primary) | BUD-01 ok; `HEAD /upload` → **403**          |
| `https://nostr.download`        | media (mirror)  | BUD-01 ok; `HEAD /upload` → 401              |
| _(private relay, from `.env`)_  | drafts (30024)  | strfry, valid cert; 6/6 probes ok, 59-195 ms |

### What came out of it, and matters for the later phases

- **CORS decides which Blossom servers are usable.** `blossom.primal.net`, the
  initial default, sends `Access-Control-Allow-Origin` on the `OPTIONS`
  preflight but **not on the actual `GET` response**: from Node it works, from
  the browser the fetch is blocked. It was invisible as long as testing
  happened only from the CLI.
- **`Access-Control-Expose-Headers` decides whether we can read the errors.**
  Blossom explains refusals in the `X-Reason` header; without that header the
  JavaScript sees the failure but not the reason. Of the ones tried, only
  `nostr.download` exposes it.
- **`blossom.yakihonne.com` answers 403 to `HEAD /upload`, not 401.** 401
  means "authentication required", 403 "you are not allowed": it may restrict
  uploads to authorised pubkeys. To be re-checked in Phase 4 with a signed
  kind 24242 event, which is the only conclusive proof.
- **No relay declares NIP-65** in its NIP-11. That is not blocking: NIP-65 is
  implemented by the client. It does mean relay lists have to be looked for on
  the indexers.
- `redirect: 'manual'` cannot be used in the browser (it produces unreadable
  opaqueredirect responses) and many Blossom servers answer 302 towards a CDN:
  the probe uses `redirect: 'follow'`.

---

## Open points

- **Private endpoints**: configured in `.env`, which stays out of the
  repository. `.env.example` carries public defaults only — a private endpoint
  in there ends up on GitHub, and that happened once.
- **`NUXT_PUBLIC_DRAFT_RELAY`**: when empty, draft saving stays disabled on
  purpose instead of falling back to a public relay (ADR 0003). NIP-37
  encrypted drafts need precisely this relay.
- **NIP-65 outbox and the follow list (kind 3)**: until they exist, the lists
  show your own events only. See «Available sections».
- **Local cache (Dexie)**: every page change re-reads from the relays. It
  works, but it is wasted traffic.
