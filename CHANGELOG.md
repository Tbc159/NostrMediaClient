# Changelog

Everything that has changed in NostrMediaClient, newest first.

The project has no released versions yet: the sections below are dated
milestones, each one a block of work that was finished, verified and merged
into `main`. Within a section the entries follow the conventions of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — Added, Changed,
Fixed, Removed.

Two things are worth knowing when reading what follows:

- **The client is a publisher, not a reader.** It manages your own content;
  seeing it as the rest of the network sees it is the job of a reading client,
  and the entries about "external clients" are about handing events over to
  one.
- **Nostr has no single "published" state.** There are relays that have an
  event and relays that do not, so an outcome is reported per relay rather
  than reduced to a success or a failure. Several entries below only make
  sense in that light.

---

## 2026-10-30 — What the manual test plan found in the import

Developed on `feature/migrazione-podcast`. Writing the plan for the manual
tests meant walking every path of the import again, the way four different
creators would take it: one with no podcast yet, one whose show is on Spotify,
one with a card in their own name, one with an account made for the show. Each
story runs on a real podcast. Three paths did not behave as a creator would
expect, and a family of misspelled messages showed up along the way. None of
them was on the main path of a move. Each was on a path a real creator takes
sooner or later.

### Fixed

- **Running the import again on the same show no longer stops it.** A card
  with a platform link or a stable address was taken for a second podcast,
  even when it was the very show being imported. The import itself suggests
  adding that link, in «Dove è già distribuito». So a second batch, or a run
  resumed after an interruption, stopped at «un secondo podcast non ci sta»
  and asked for a dedicated key. The import now recognises the show by its
  `podcast:guid`. When the card on the key already has the identity the import
  inherits, the import says so and asks nothing about the key or the
  distribution. It leaves the card as it is, hides the fields that would only
  have rewritten it, and publishes only the episodes that are missing.
- **A card made by hand for the show is no longer taken for another
  podcast.** Take a creator who made an account for their show, and a card for
  it while the show still lived on its old host. That card naturally carries
  the show's Spotify or Apple links. Those links made it «distributed», so the
  import refused that account — the one made for the show — and proposed
  creating yet another key. Platform links alone no longer decide. The import
  asks whether they are the links of the show being imported, and explains
  when to answer yes: when the card's own feed was never submitted anywhere.
  «Yes» lets the import replace the card field by field, with the identity
  inherited from the old host, keeping the card's links. «No» protects the
  card as before. A stable address (the `feed` tag) still protects the card
  without asking, because NMC only hands a feed out once it has one.
- **Pasting the show's page instead of its feed gets an explanation, not a
  CORS error.** A creator who thinks «my podcast is on Spotify» pastes
  `open.spotify.com/show/…`, or the Apple Podcasts link. The browser cannot
  read those pages, so the error spoke of CORS and suggested saving the file
  as XML: the wrong way. The import now recognises the show pages of Spotify,
  Spotify for Creators, Apple Podcasts, Amazon Music, YouTube and Podcast
  Index before fetching anything. It says that the platform reads the feed
  from the host rather than serving one, and where the feed is to be found.
  An address that names a feed, such as YouTube's `feeds/videos.xml`, is let
  through. Any other web page that gets downloaded is named as a web page,
  with a hint of what feed addresses usually look like.
- **Accented words written with an apostrophe.** About sixty messages across
  the client and the core library had them: errors, the platforms'
  requirements, signing, drafts, downloads and diagnostics. They read «Non e’
  un feed RSS», «non si puo’ sottoporre», «gia’», «identita’», sometimes with
  a straight apostrophe. They now read «è», «può», «già», «identità». One of
  them was built from four string pieces that left a stray apostrophe in the
  middle of the sentence; it is one sentence again.

---

## 2026-10-30 — Your relays and Blossom servers follow your key

Developed on `feature/migrazione-podcast`, after the move below. Until now the
relays and Blossom servers chosen in the settings lived in one browser: logging
in elsewhere started again from the `.env` defaults, and the comments in
`.env.example` and `config/defaults.ts` promised a synchronisation through
kinds 10002 and 10063 that did not exist. It exists now, built so that it can
never rewrite a list the user did not look at.

### Added

- **The key's lists are read at every login.** When an identity becomes active
  — logging in, restoring a session, switching identity — NMC reads its kind
  10002 (NIP-65, the relays) and kind 10063 (BUD-03, the Blossom servers) from
  the indexers and the configured relays. When they differ from this
  browser's endpoints and nothing newer was chosen here, it takes them: a new
  browser starts from the user's relays, not from someone else's defaults. The
  settings say so, with the date of the list that was taken.
- **A newer choice made here is not taken back.** Changing the relays or the
  servers in the settings is noted with its time, per key. A published list
  signed before that change is not taken: the page marks the two as
  «diversa», shows the published list, and offers both ways — publish the
  one from here, or use the published one. A change made with one identity
  does not count for another: switching back to a key brings its own lists
  back.
- **Publishing is explicit, and previewed.** A new card in _Settings_, «Relay
  e server Blossom sul tuo account», shows each list's state and publishes it
  only on request, after showing exactly what will be signed — each relay with
  its use (read, write, both), each server with its role (primary, mirror) —
  and a warning that the relay list is read by every client the user has, not
  only NMC. Reading never publishes anything. The new list goes to the write
  relays, the indexers, and, for the relays, to the previous list's write
  relays too, so that whoever still reads there finds out it changed. Tags
  another client added to the previous version are kept, and the outcome is
  shown relay by relay.
- **What only this device can reach stays out of the lists.** A relay on
  localhost, a server on the home network, anything without TLS: published, it
  would send the rest of the network where it cannot go and say something about
  the user's network that is nobody's business. It stays in this browser's
  endpoints, untouched — also when a published list is taken — and the preview
  names it. With nothing reachable from outside, there is nothing to publish,
  and the page says so.
- **Kind 10063** in the core (`blossomServersDefinition`), and the pure logic of
  the lists in `config/liste.ts` (`listeDaConfig`, `campiDaListe`,
  `stessiRelay`, `stessiServer`, `indirizzoPubblico`, `destinazioniLista`),
  with 25 unit tests.
- **Prompt N** in `doc/api-to-build.md`: the feed service keeps a moved
  catalogue whole. Reading the deployed Prompt K showed that the service asks
  the relays for 200 episodes, which relays pick by `created_at` — the import
  day — and only then sorts by `published_at`: a catalogue bigger than that
  loses episodes, and which ones depends on the order of the import. The
  prompt asks for paging, the cut by publication date, a higher default, and
  one item per episode GUID. Prompt M now says that a card without its
  `podcast:guid` keeps the one computed on today's host when the APIs move.

### Changed

- **The dedicated key's lists follow the same rules.** Its 10002 leaves out
  what only this device can reach and goes to the indexers too, where the feed
  service looks it up; it now publishes a 10063 as well. When nothing is
  reachable from outside, the list is not published instead of failing.
- The comments in `.env.example` and `packages/nostr-core/src/config/defaults.ts`
  describe what actually happens.

### Fixed

- **Stray spaces before punctuation, across the whole interface.** Prettier
  formats the templates with `htmlWhitespaceSensitivity: 'ignore'`, which puts
  every inline element on a line of its own when a paragraph is long; Vue
  turned each of those line breaks into a space, and the pages read
  «impostazioni .», «itunes:new-feed-url , per», «( podcast:guid )». Moving
  the punctuation in the source did not last: the next format broke the line
  again. A template compiler transform (`apps/web/compiler/punteggiatura.ts`,
  wired in `nuxt.config.ts`) now removes the space before closing punctuation
  and after opening punctuation, in every component, including the ones not
  written yet. Measured on the compiled templates: 57 occurrences before, none
  after. `<pre>` and `<textarea>` are left alone.
- **A podcast card without an identity got a new one when given a stable
  address.** The profile page computed the `podcast:guid` from the stable
  address the first time one was set. For a card the feed service had already
  served, that changed the show's identity: the service had been declaring the
  one of its technical address, and whoever indexed the show knows it by that.
  The page now inherits the identity the feed declares — read from the feed,
  or computed the way the service computes it — and only a new card takes it
  from its stable address.

## 2026-10-30 — Moving a podcast to NMC without losing it

Developed on `feature/migrazione-podcast`. A podcast that already lives on
another host can now move to NMC keeping what its creator built there: the
episodes with their GUIDs and original dates, the show's identity in Podcast
Index and Fountain, its Lightning split and its listeners on every platform.
And a podcast's feed now has an address its creator owns, instead of the
service's. The analysis behind it was done on the real test feed
`https://anchor.fm/s/117e26658/podcast/rss`, and the whole design is in
`docs/PODCAST.md`, «Stable address and moving from another host».

### Added

- **Import a podcast from another host** (_Media → Podcast_). Read the old feed
  by URL, or paste it, or load the file. The preview shows the show's card with
  every field editable, the identity it will inherit, the warnings, the
  Podcasting 2.0 elements that will not be carried with how many episodes use
  them, the Lightning split one recipient per row, and the episodes with date,
  duration, season and number. Then the card is published, and the episodes one
  at a time, each with its own outcome.
- **A locked feed stops the import.** When the old feed declares
  `<podcast:locked>yes</podcast:locked>` nothing is imported: the old host is
  protecting the show from being copied, and the page says to unlock it there,
  showing the owner's declared email.
- **The files go to Blossom, or stay where they are.** By default audio,
  images, transcripts, chapters and the show's cover are copied to Blossom, so
  the podcast stops depending on the old host and its account can be closed.
  The alternative keeps the original URLs. An episode without a GUID keeps its
  original URL by default: the apps know it by that address.
- **Blossom is asked before downloading.** Each file is announced to the server
  with BUD-06 `HEAD /upload`; a 413, 402 or 415 leaves that episode at its
  original address, with the server's reason beside it, instead of failing
  after a long download.
- **A safety limit on what one import copies**: 2 GB by default, editable in
  _Settings → Importing a podcast_. Above it the import proposes the newest
  episodes that fit, and the rest goes in later batches: running the import
  again skips what is already on the key, recognised by the original GUID or,
  without one, by title and date.
- **The old host's fee recipient is left out** of the Lightning split by
  default: hosts usually add themselves to it as a fee, and after the move they
  should no longer get a share of the boosts.
- **«Which key does the podcast live on»**, asked before the first card, on the
  import and in the profile. The active identity, or a **dedicated key** NMC
  creates: it separates the show from the person, allows more than one
  podcast, and can one day be handed over. The new key is encrypted with its
  own password (NIP-49), its nsec is shown once with an encrypted backup to
  download, and nothing is published until the user confirms it is safe. Then
  the personal key publishes its 10064 naming the new one, the new key
  publishes its profile and its relay list, the active identity switches to
  it, and its card names the personal key as `host`.
- **Saved identities.** Every identity used in the browser stays in a list,
  local keys encrypted as before. «Cambia identità» in the header and
  _Settings → Identità salvate_ switch between them; one key is open at a time,
  and a local key arrives locked until its password is given. «Aggiungi
  un’altra identità» logs into one more without leaving the current one.
- **A card already on the key is protected.** If it has a feed address or
  links to the platforms, or the user says it is already distributed, the
  import will not replace it and proposes a dedicated key. Otherwise each field
  can be taken from the import or kept, other clients' tags survive, and the
  episodes already on the key are listed because they will share the feed.
- **The feed's stable address**, in the podcast card. The creator's own domain
  through an intermediary of theirs is the way available today, with
  ready-made Caddy, nginx and Cloudflare Worker configurations; «Verify
  address» checks that it serves this key's feed, and tells a redirect, a
  missing CORS header and another feed apart. A CNAME to the service and a
  subdomain managed by NMC are shown as «Coming soon»: they can be tried end
  to end on a simulation that calls nothing, signs nothing and saves nothing,
  and they turn on only when `NUXT_PUBLIC_FEED_DOMINI_GESTITI` is set and the
  service declares them.
- **`podcast:guid` is written once.** An imported show inherits the old host's
  (declared, or computed from the old feed's address as Podcast Index does); a
  new one gets it from its stable address at the first publication that has
  one. It is then shown read-only and never recomputed.
- **The card's feed fields**: the author the feed signs with, episodic or
  serial, the Lightning split with each share's percentage, the funding links
  and the people.
- **A parity check before the redirect** (_RSS feed → Coming from another
  host?_): compares the old feed with NMC's and says whether the redirect is
  safe, listing each difference as blocking or worth a look.
- **Platforms where the show already is** are marked «già distribuito» with
  «non risottomettere» instead of a submission link. For YouTube the card
  explains how to relink the feed in Studio and proposes the start date from
  the newest imported episode.
- In the episode form, «Da un altro host, o in una serie»: original GUID, first
  publication date, season, number and type.
- Core: kind 10002 (NIP-65), kind 27235 (NIP-98) with `autorizzaRichiesta`,
  `uuidV5` and `podcastGuidPerUrl`, `leggiFeedEsterno`, `confrontaFeed`,
  `confrontaIndirizzoStabile`, `validaSottodominio`, `validaDominio`,
  `recordCname`, `accettaUpload`, and the NIP-73, `published_at`, numbering and
  Podcasting 2.0 tags on kinds 54 and 10154.
- `doc/api-to-build.md`: Prompt K (the feed reads all of the above), Prompt M
  (managed subdomains) and Prompt L (custom domains by CNAME).

### Changed

- **No feed URL without a stable, verified address.** The «RSS feed» card no
  longer shows or copies the service's technical address, generates no OPML
  and offers no submission guide until the card carries a stable address that
  serves this feed under its own name; «Piattaforme» hides its «Sottoponi su»
  buttons the same way. The technical address is still what NMC reads the feed
  from, to check it. A feed already submitted with the technical address keeps
  working: only NMC stops handing that address out.
- Prompt K emits `itunes:new-feed-url` only when the card names a stable
  address: filled from the request URL, it would move a proxied show to the
  technical address.
- The comparison takes the old show's identity from the address its feed
  declares, as the import does, before the address it was read from.
- Blossom's own reason (`X-Reason`) for refusing a file in advance now reaches
  the message.

### Fixed

- **The external clients chosen in the settings were not saved**: the choice
  per platform and the clients added by hand lived in memory only and were
  lost on reload. Every setting is now persisted, and the type system checks
  that none is left out.
- The profile page did not reload the podcast card and the author list when
  the identity changed, only the profile.
- The translation of 16 October had missed the configuration files, the CI
  workflows, the lint messages, the dependency guard's output and about 25
  section headers and short comments in the application. They are in English
  now.

## 2026-10-16 — The repository speaks English

### Changed

- **Every comment and every document in the repository is now in English.**
  Around 2 000 lines of comments across the core package, the Vue application,
  the tests and the scripts, plus the three ADRs, the podcast guide, the
  progress file and the API document. The reason is practical: Nostr's
  specifications, the libraries and the people who might read this code are
  English-speaking, and a codebase whose explanations are in another language
  halves the audience that can check them.
- **The identifiers stay Italian.** `conTagClient`, `bozza`, `piattaforme`,
  `firmatario`: renaming them would have been a mechanical change across every
  file with no gain in clarity, since a name is read for what it refers to and
  not for what it means. The rule adopted is therefore: comments and
  documentation in English, names as they are.
- **The strings shown to a person stay Italian.** The application's interface
  is Italian and remains so; translating the error messages in the core
  package would have produced half-English alerts in an Italian UI. Where a
  message is developer-facing only — an assertion, a script's output — it is
  in English.
- **Files with Italian names have been renamed**, and with them their
  imports: `media/estensioni.ts` → `media/extensions.ts`, `media/scarica.ts` →
  `media/download.ts`, `signers/trasporto.ts` → `signers/transport.ts`,
  `signers/delega.ts` → `signers/delegation.ts`, `audio/attesa.ts` →
  `audio/wait.ts`, `audio/tipi.ts` → `audio/types.ts`,
  `podcast/categorie.ts` → `podcast/categories.ts`, `podcast/piattaforme.ts`
  → `podcast/platforms.ts`, `kinds/conservazione.ts` →
  `kinds/preservation.ts`, `servizi/` → `services/`, `episodi/` →
  `episodes/`. The ten Italian-named test files and the two fakes were renamed
  the same way.
- **The test names are in English**, all 410 of them, and the awkward string
  concatenations that avoided apostrophes (`'non e' + ' modificabile'`) are
  gone with them.
- `scripts/client.sh` is fully in English, messages included: its help text
  _is_ its header comment, so a half-translated script would have printed half
  a language.

### Note

The application's routes keep their Italian names (`/profilo`,
`/impostazioni`, `/calendario`): they are URLs the user sees and bookmarks, so
they belong to the interface rather than to the code. Making the UI bilingual
would need the core's error messages turned into codes (88 of them) plus about
260 interface strings and ten `it-IT` formatting sites; it has not been done.

---

## 2026-10-14 — Images for calendar events

### Added

- An event's image can be uploaded **without interrupting the composition of
  the event**: the same field as the article's, with the list of what is
  already on Blossom. Before, whoever had the poster on disk had to leave the
  form, go to Media, upload it, copy the address and come back.

---

## 2026-09-24 — The client declares itself, and edits stop losing data

### Added

- **Every published event carries `["client", "NostrMediaClient"]`** (NIP-89,
  in its simple form). It is injected in `defineKind`, which every one of the
  seventeen definitions passes through, so no kind can be composed without it
  — and an existing `client` tag from another client is overwritten rather
  than sitting beside ours. The Blossom authorization (kind 24242) is
  excluded: it is an HTTP header, not a publication.
- **A «Tag» section at the bottom of the editing forms** — calendar, RSVP,
  articles, profile, the podcast's card, the authored-podcasts list. Every
  position of every tag is editable, because a Nostr tag is an array and not a
  pair, and free tags can be added (`field-name: valueX`). The only warning
  concerns a name the form writes itself, where two tags of the same name
  would make the event ambiguous.

### Fixed

- **Editing an event no longer throws away what the form does not model.**
  Reopening a Plektos calendar event and republishing it used to lose `lat`,
  `lon`, `place_id`, the three colour tags, `description`, `client` and the
  geohash, and would split the hashtag `Food & drink` into three. Now a
  snapshot is taken when the event is opened — parse, rebuild, diff the tag
  _names_ — and everything the kind does not write comes back in the
  republished event. The snapshot is deliberately taken once: recomputing it
  would let a field the user had just emptied back in through the window.
- Hashtags are kept **to the letter**: the lower-case convention moved to the
  form, where what the user types is normalised, so another client's category
  is no longer rewritten while its title is being corrected.
- **Kind 0 keeps the fields it does not know.** A client that writes
  `pronouns` or `birthday` used to see them vanish on the first save made
  here; the schema now preserves the unknown and rewrites it unchanged, and
  the profile page lists what it is keeping.

### Fixed (development)

- Starting the client rebuilds the monorepo's packages first. A stale `dist`
  after a change of branch produced a blank page **with no errors in the
  server's log**, because the failure happened in the browser.

---

## 2026-09-18 — The podcast, ready for the platforms

### Added

- **What the platforms demand, in the events**: the category (Apple's 19
  official ones, with their sub-categories), the language, the owner's email,
  the explicit flag and the episodes' duration. NIP-F4 does not provide for
  them, so they live in the kind 10154 and the kind 54 as simple tags the
  feed's service can read.
- **A checklist per platform** — Podcast Index, Apple, Spotify, Amazon,
  YouTube — computed against the real data: this key's card, the measured
  cover, the episodes' formats. Instead of a generic «invalid feed» it says,
  for each platform, _what is missing_ and where to submit.
- **A square cropper** for the covers, with zoom and drag: Apple, Amazon,
  Spotify and YouTube want a square between 1400 and 3000 px, and asking the
  user to crop elsewhere is the way to have wrong covers published.
- **An «RSS feed» card in the profile**, under the podcast's: it shows the
  URL, really checks it by downloading and reading it, and names the published
  episodes that are not in the feed.
- **«Redistribute to the relays»** for the card and the episodes: the same
  event, already signed, sent to every write relay. A relay that has it
  answers «duplicate», which counts as a success. It is the remedy for an
  event that ended up on a single relay while the feed's service reads from
  another.
- The feed can be downloaded as **OPML**, which is what podcast apps exchange
  subscriptions in. It always carries the title read from the feed: Fountain
  looks every entry up in its own catalogue _by title_, and a generic
  «Podcast» had people subscribe to 127 unrelated shows.

### Fixed

- Cropping an image given **by link** downloads it first — directly when the
  server allows it, otherwise through the media-manager, which reads it from
  its own side. A canvas drawn from an image without CORS stays tainted and
  cannot be exported, so before this the operation simply failed.
- The «Publish» button no longer **reappears** after a successful signing and
  publishing: pushing the event to the relays that did not take it is done
  from the outcome, relay by relay.
- The feed is fetched with `no-store`: the browser used to keep its copy for
  `max-age`, so «Check» right after a publication showed the previous feed.
- Blossom URLs keep the extension the players expect — `.mp3` and not the
  `.mpga` yakihonne answers with for `audio/mpeg`. BUD-01 obliges a server to
  accept any extension when reading, so the client chooses.

---

## 2026-09-12/13 — Delegated signing, and events seen from outside

### Added

- **NIP-46 delegated signing**, both sides. The signing desk keeps the key in
  this browser and approves every request by hand; the delegation side asks
  from afar and publishes under the podcast's identity. It is the answer to
  what NIP-F4 leaves exposed: a podcast _is_ a key, so whoever prepares the
  episodes without holding it has no other way to publish in its name. Two
  keys are kept distinct throughout — the transport key, which is the desk's
  address, and the identity that signs.
- **An exportable episode proposal**: the asynchronous counterpart to the
  delegation. The same data as a draft, written to a file; whoever imports it
  finds the files already on Blossom and signs with their own key.
- **Kind 10064**, the podcasts a key declares itself an author of: the other
  half of the cross-check, since a podcast's card can claim anyone.
- **Transmit** among the external clients: a Nostr podcast player that has a
  page per _show_ rather than per event, and that wins over a social client
  for episodes and show cards — showing an episode as raw text is not showing
  it.
- Every event card can show **the JSON it is published as**, collapsible: it
  is the only true representation of what sits on the relays.
- The menu shows the **profile's name** instead of the npub, when there is one.

### Changed

- The podcast's card, the profile and the lists go to **every relay**
  whatever rotation strategy is chosen: they are events that have to be
  _found_, and a show whose card is on `nos.lol` is invisible to a player
  reading `relay.damus.io`. That happened.

---

## 2026-09-06/11 — Audio pre-processing

### Added

- **An Audio section** that levels a recording, cuts its silences and converts
  it, against the media-manager's `audio` domain. Every job is a job: 202 with
  a `job_id`, then polling; jobs survive a restart of the service, so giving
  up waiting does not lose the work.
- Two **sliders** for the silence threshold and the minimum pause: the right
  value depends on the recording, and a text field would have it chosen blind
  because the decibel scale is not in common use.
- The processed audio is **handed to «Upload to Blossom»** in podcast mode,
  in memory and not through a query string.

### Changed

- The services' hosts and keys moved **into the settings**, with the
  environment's values as first-run defaults: whoever opens «Audio» wants to
  work on a recording, not answer administration questions.

### Fixed

- A medium is referred to by the **`filename` the service generates**, not by
  the title we sent it: they are two different fields and the second does not
  resolve. It is the defect a fake that resolved by title would have confirmed
  instead of uncovering.
- «No domain answers» is told apart from «the audio domain is missing»: from a
  browser the first is nearly always CORS or the address, and saying «the
  audio is missing» sends you looking for the problem where it is not.

---

## 2026-08-31/09-03 — Publishing, and handing events over

### Added

- **The media flow in three distinct moments** — choosing, uploading,
  publishing — because there is no real coming back from Blossom: a blob is
  identified by its hash and anyone who knows it can download it again. An
  invariant stands: if the upload fails, no event is published.
- A note with an attachment (NIP-92) and a podcast episode (NIP-F4) among the
  ways to publish. A note with an attachment is the only way to publish a file
  that _any_ social client shows.
- **Opening an event in an external reading client**, chosen per device:
  `matchMedia` decides, not the user agent. When the chosen client cannot
  display a kind the client falls back on one that can and says so — noStrudel
  opens a calendar event under «Unknown event kind», without the date or the
  place it exists for.
- The client is published as a **static site on GitHub Pages**.

### Fixed

- The external links were corrected against the real clients, loading all
  three NIP-19 forms in a browser: noStrudel answers «Unknown type naddr» on
  `/n/`, and Primal answers 404 to an `nprofile` on `/e/`.

---

## 2026-08-26/28 — The foundations

### Added

- **A kind registry** that describes formats and checks, at registration time,
  the consistencies the compiler cannot: a class that matches the number,
  `editable` only where NIP-01 allows replacement, an identifier for the
  addressables. Adding a kind makes it appear in the interface without
  touching a page.
- **Publishing and reading from the relays**, with a per-relay outcome and two
  strategies — one at a time, stopping at the first that accepts, or all in
  parallel. The trade-off is real and has no single answer, so the choice
  stays with the caller.
- **Three login modes**: a NIP-07 extension, an npub for read-only, and a
  private key encrypted at rest with NIP-49. A non-negotiable rule: the
  decrypted key never enters the store's state, so it cannot be serialised
  into Nuxt's SSR payload.
- **NIP-37 encrypted drafts**, with the kind 10013 private relay list: an
  empty content means a deleted draft, and the public identifier is a hash so
  the relay does not learn the title from the `d` tag.
- Reopening the replaceable events for editing, the profile and the RSVPs
  included.
- The calendar kinds aligned to the current NIP-52, the `D` tag included —
  anchored to UTC, as the specification computes it, so the indices match the
  ones other clients compute.
- A README, the PolyForm Noncommercial licence and a note on commercial use.

### Fixed

- Signing with NIP-07 extensions: the template is flattened before being
  handed over. Extensions pass the event to their content script with
  `postMessage`, which uses the structured clone, and the structured clone
  refuses the Proxy a reactive interface wraps everything in.
