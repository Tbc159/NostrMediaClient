# The media-manager microservice API — state and prompts

A working document for NostrMediaClient. It was started to collect **what was
missing** from the
[`microservice-media-manager`](https://github.com/Tbc159/microservice-media-manager)
service for this client to be able to use it, and the **prompts** to hand to
whoever develops it.

> **State as of 10 September 2026 — the prompts have been carried out.** On the
> service's `feature/content-custom-fonts` branch there are commits
> implementing A (CORS and HTTPS), B (`POST /v0/media/from-url`), C (the
> complete `audio` domain), D (the `social` and `slide` presets, the format
> enum, listing without a filter), E (signed URLs) and an unambiguous asset
> contract with diagnosable `400` errors.
>
> **The client is already aligned with that contract.** The **Audio** section
> is in `main` and does everything through the `audio` domain; the previous
> service is no longer called from anywhere. The **Process** section (images:
> references by `filename`, `from-url`, previews with `signed_url`) stays on
> the `feature/elabora-immagini` branch until its UX is revised.
>
> **Only the deployment is missing.** Verified with `curl` today against
> `http://mediamanager-dev.duckdns.org`: `/v0/audio/health` answers `404`, the
> `OPTIONS /v0/content/image` preflight answers `405` with no CORS headers, and
> `https://` does not answer. Until that branch is merged and published, the
> two sections do not work from the browser against the development
> environment: the client was verified against a fake faithful to the contract.

The prompts stay below as a record of what was asked and why: they are the
explanation of the choices the contract now carries inside itself.

---

## 1. What exists today

The service is contract-first: the truth is in `openapi/<domain>/api.yaml`. On
the `develop` branch there are three domains; `main` has only one, because it
is an environment branch.

| Domain    | Exposed      | Operations                                                                                                            |
| --------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `media`   | public       | `GET /v0/media` (requires `type`), `POST /v0/media` (multipart), `GET /v0/media/{id}`, `GET /v0/media/{id}/content`   |
| `content` | public       | `POST /v0/content/image` — `tipo`: `copertina` (live), `composita` (live, 1920×1080 layer engine), `social` (**501**) |
| `source`  | **internal** | the archive; includes `POST /source/media/from-url`, not reachable from outside                                       |

Authentication: the `X-API-Key` header. The reverse proxy root declares
«public domains: content media», and indeed `/v0/source/health` answers 404.

**There is no audio endpoint at all.** The paths `/yt/media/social` and
`/yt/slide` do not exist in this repository: the name comes from the
`create_yt_media.py` client script in the previous repository, which
orchestrated `POST /media/normalize` and `POST /media/remove_silence` on the
`ffmpeg` service.

---

## 2. Two obstacles that block everything, before any feature

Verified with `curl` against the development environment.

**a. No CORS headers.** A `GET /v0/media/health` with
`Origin: https://tbc159.github.io` comes back without
`Access-Control-Allow-Origin`, and the `OPTIONS /v0/content/image` preflight
answers `405 Method Not Allowed` with `allow: POST`. From a browser **every
call is blocked before it leaves**: it is not a network problem nor a key
problem, and on the client side it shows up as «service unreachable» while
from `curl` everything works.

**b. No HTTPS.** `https://mediamanager-dev.duckdns.org/` does not answer. The
published client lives on GitHub Pages, so on `https`: a request towards
`http` is **mixed content** and the browser refuses it regardless of CORS.

While these remain, the client's «Process» section only works against a local
service.

---

## 3. Prompts for the agent — in dependency order

### Prompt A — Make the service usable from a browser (blocking)

```
You are working on the microservice-media-manager repository, contract-first
(OpenAPI 3.0, `openapi/<domain>/api.yaml` is the single source of truth),
branch develop → staging.

Goal: make the public domains `media` and `content` callable from a web
application served from another origin.

Verified state (6 September 2026, environment mediamanager-dev.duckdns.org):
- a GET /v0/media/health with an Origin header receives no
  Access-Control-Allow-Origin;
- OPTIONS /v0/content/image answers 405 with `allow: POST`, so the preflight
  fails;
- https:// on the domain does not answer: there is only http.

To do:
1. CORS on the public domains only (`media`, `content`), not on `source`.
   The OPTIONS preflight must answer 204 and include:
   - Access-Control-Allow-Origin: the configured origins (a list from an
     environment variable, not `*` once API keys are in use);
   - Access-Control-Allow-Headers: content-type, x-api-key;
   - Access-Control-Allow-Methods: GET, POST, OPTIONS;
   - a sensible Access-Control-Max-Age.
   Decide whether this goes in nginx (reverse proxy) or in Connexion/Flask:
   pick exactly one of the two, because duplicate headers make the preflight
   fail in a way that is hard to diagnose.
2. HTTPS on the development domain (Let's Encrypt through DuckDNS), with a
   redirect from http.
3. A contract test that checks the preflight: OPTIONS on a public endpoint
   must come back 204 with the three headers. It is the easiest regression to
   reintroduce and the hardest to notice, because curl does not see it.

Constraint: `source` must stay unreachable from outside.
```

### Prompt B — Fetch an asset from its URL, without routing it through the browser

```
Repository: microservice-media-manager, contract-first, branch develop.

Context: the client keeps its files on Blossom (a content-addressed store
keyed by hash, with public URLs). To process them, today the browser has to
download the bytes from Blossom and upload them again with a multipart
POST /v0/media: the bandwidth is paid twice and large files go through the
page's memory.

In the internal domain there already is a `POST /source/media/from-url`,
declared "internal use" and not exposed.

To do:
1. Expose in the public `media` domain a `POST /v0/media/from-url` accepting
   `{ url, title, media_type?, duration_s? }`, which downloads the content
   server-side and creates the media, delegating to source.
2. If `media_type` is absent, derive it from the response's Content-Type; if
   the type is not among the accepted ones, answer 400 saying which one was
   detected — not a 500.
3. Defences, because the URL comes from outside: allow only http/https, refuse
   addresses that resolve to a private or loopback network (SSRF), impose a
   size limit and a timeout, do not follow more than N redirects.
4. If the content is already present, answer 409 as POST /v0/media does, so
   the client can reuse the existing record instead of treating it as an error.
5. Tests: a valid URL, a type that is not accepted, an address on a private
   network, a file over the limit, a duplicate.
```

### `microservices-media` is being decommissioned

The `ffmpeg` service in the previous repository is still alive on
`http://api-v0-bitcoinradio.duckdns.org`, but **the client no longer calls it
from anywhere**: the adapter that spoke to it has been removed, along with the
three workarounds it imposed — the forced order of operations, silence removal
reserved for mp3s, and pauses zeroed instead of shortened.

Nothing is to be done on that repository: no PRs, no fixes, not even for the
defects listed in the prompt below. It stays up until the media-manager's audio
domain is published, and serves as a yardstick — once ported, on the same file,
the result must be at least as good.

### Prompt C — Rebuild the audio domain inside the media-manager

A self-sufficient prompt, to hand to the agent developing
`microservice-media-manager`. It replaces and absorbs the earlier Prompt C-bis.

Every statement in it comes from code that was read or from a measurement that
was taken, never from an impression: where it is a measurement, the numbers are
reported so that it can be repeated.

```
Repository: microservice-media-manager, contract-first (openapi/<domain>/api.yaml
is the single source of truth), branch develop.

GOAL
A new public `audio` domain, bringing here the audio processing that today is
only available in the previous repository (microservices-media, branch dev,
service `ffmpeg`).

SCOPE RULE, BINDING
microservices-media is **being decommissioned**. Do not open PRs, do not fix
bugs, do not add parameters there: not even the ones this prompt describes as
defects. That code is to be read as a reference and nothing more. All the work
belongs in this repository. If you notice a feature of the old service that is
not described here, report it instead of going to fix it where it lives.

WHO WILL CONSUME THESE APIS
A web client (NostrMediaClient) that today speaks to the old service behind an
interface of its own. Once this domain exists, the client will only change the
adapter: **compatibility with the old routes is not needed**, parity of
capability is. The capabilities it uses today, in flow order:
  1. it sends an audio file (mp3, m4a or wav)
  2. it removes silences, with a threshold in dB and a minimum pause length,
     both set by the user with a slider
  3. it levels the voices and picks the output format
  4. it follows progress and can stop waiting
  5. it downloads the result again to listen next to the original
The client is served from a browser: **CORS and HTTPS apply to this domain
too** (Prompt A). Without them, it is not callable from a browser.

MINIMUM OPERATIONS
  POST /v0/audio/normalize   levels the speech
  POST /v0/audio/silence     shortens the silences
  POST /v0/audio/convert     changes container/codec (replaces m4a_to_mp3)
  POST /v0/audio/analyze     measures and changes nothing (see §7)
  GET  /v0/audio/job/{id}    the state of a processing job
From the old service it is also worth porting `split` (cutting a long episode)
and `concat` (intro + body + outro). Do NOT port `radio/*`,
`media/clock/assemble` (radio schedule), `voice/generation` and `voice/mixing`
(Piper speech synthesis): they are another domain.

The input is a medium already in the archive (an id or a reference, as
`content` does), not an upload inside the operation: that way the same source
is reused across several attempts. The output is a new medium, and the response
carries its id and URL, as GET /v0/content/image does. The operations are long:
a job model with polling (POST -> 202 + job_id, GET .../job/{id} -> state).

--- THE MODEL: six constraints NOT to reproduce ----------------------------

1. REFERENCES TO FILES, NOT A FOLDER PER OPERATION. This is the cause of all
   the rest. In the old service `remove_silence` reads from CONVERTED_FOLDER
   (uploads/mp3_media) and writes to CLEANED_FOLDER, while `normalize` writes
   to NORMALIZED_FOLDER. Two limits follow from that with no reason to exist:
   - **the order of operations is forced**: normalising first puts the file in
     a folder that silence removal does not look at, and the chain breaks (it
     is almost certainly why that step is commented out in create_yt_media.py);
   - **silence removal only works on mp3s**, because it reads from the mp3
     folder: an m4a has to be converted first, and a wav cannot be done at all.
   Here every operation must accept the same kind of reference and resolve it
   the same way. With that, free ordering and format independence — two limits
   that disappear without writing a line against them.

2. DO NOT DESTROY THE INPUT. In the old service `remove_silence` does
   `os.remove(input_file_path)`, and so does `m4a_to_mp3`. A concrete
   consequence, already visible in the client: the page offers a slider for
   the silence threshold, and **trying again with a different threshold is the
   most natural action in the world** — but the starting file no longer exists
   and has to be uploaded again. An operation produces a new object and leaves
   the starting one untouched; cleanup is a retention policy, not a side
   effect.

3. DO NOT RE-COMPRESS AT EVERY STEP. The current chain on an mp3 does three
   lossy generations: the original, `remove_silence`'s re-encode (which reuses
   the source's codec and bitrate) and `normalize`'s. Intermediate stages
   should work losslessly (wav or flac) and compression should happen **only
   in the last step**, the one that produces the delivered file.

4. EVERY LONG OPERATION SHOULD BE A JOB. In the old service `remove_silence`
   is synchronous while `normalize` and `m4a_to_mp3` are asynchronous. On a
   long file the synchronous request hangs until something times out — a
   proxy, the browser — and the client cannot tell «it is working» from «it
   died».

5. JOBS SHOULD SURVIVE A RESTART. In the old service `jobs` is an in-process
   dictionary: a restart loses the work in progress and more than one worker
   cannot work. Shared, persistent state is needed.

6. NO `verify=False`. In `normalize`'s `requests.get` the TLS certificate
   check is turned off. If it is needed for an internal certificate, add that
   CA instead.

--- PROCESSING: what ffmpeg does, measured ---------------------------------

The existing code does NOT produce the intended effect, and the cause has been
measured. The current chain in ffmpeg/processors/ffmpeg_processor.py:

    -af dynaudnorm=f=500:g=31:p=0.95,loudnorm=I=-16:TP=-1.5:LRA=11

The test run (ffmpeg 6.1.1) on a synthetic file with two alternating speakers,
one at -12 dBFS and one at -30 dBFS, 6 s turns and 2 s pauses, measuring the
integrated LUFS of each turn:

    source                            gap between the two speakers: 18.0 LU
    current chain                     gap: 11.1 LU     <-- does not align them
    dynaudnorm f=250 g=11 (default m) gap: 11.6 LU
    speechnorm                        gap: 14.8 LU
    dynaudnorm f=250 g=11 m=100       gap:  0.2 LU     <-- aligned
    same + loudnorm I=-16             gap:  0.4 LU, file at -16 LUFS

Cause: `dynaudnorm` has `maxgain` (m) defaulting to **10**, that is +20 dB.
With an 18 LU difference the quiet voice would ask for about 30, it is capped
at 20, and the ~11 LU measured remain. It is not the smoothing window:
shortening it changes almost nothing while the ceiling stays.

A measured side effect, not to be hidden: with background hiss at -70 LUFS,
raising m lifts the floor in the pauses from -58 to -51 LUFS. It stays ~34 dB
below the programme, but on noisy recordings a gate or noise reduction is
needed first.

Therefore:
  a. make `maxgain` an API parameter, with a high default (50-100) and not
     ffmpeg's 10; document it as a correction ceiling in dB (20*log10 m).
  b. The recommended pipeline is **silences first, then normalisation**.
     Measured: normalising first, the amplification lifts the noise floor
     above the silence threshold and removal no longer recognises it — on the
     same file, 56.2 s against 28.1 s of final duration. With point 1 of the
     model the order is no longer imposed by the infrastructure: it stays a
     recommendation to write in the endpoint's documentation, which is the
     right place for a quality choice.
  c. `silenceremove` is currently invoked as
     `stop_periods=-1:stop_duration=...:stop_threshold=...`, which **zeroes**
     the pauses and produces unnatural cuts. Expose `stop_silence` (how much
     silence to leave, e.g. 0.3 s) with a default that leaves an audible
     pause, and document that `stop_threshold` wants a unit (`-40dB`),
     otherwise it is linear amplitude. It is the parameter missed the most.
  d. Consider `loudnorm` in two passes (measure, then apply with `measured_*`
     and `linear=true`): in a single pass it works dynamically and adds a
     second compression on top of dynaudnorm's. This was not measured: check
     it before deciding.
  e. A known limit to declare in the API, not to solve: when two voices
     overlap in the same channel none of these techniques separates them. If
     separate per-speaker tracks exist, normalising them individually before
     the mix gives a much better result — consider an endpoint accepting
     several tracks.

--- 7. POST /v0/audio/analyze: measurement as a feature --------------------

It is the endpoint that helps the interface most, and it exists nowhere. It
returns, without changing anything: integrated loudness (LUFS), true peak,
loudness range, the **background noise level**, and the distribution of
silence lengths above a few thresholds.

Why it matters: today the client proposes -40dB and 1s as defaults, and they
are reasonable *in general*. With a measurement it can propose the right
threshold **for that recording** — the difference between a slider moving
blind and one that starts in the right place. An analysis should also be
reused: the result must be attached to the medium, not recomputed every time a
page opens.

--- CONTRACT ---------------------------------------------------------------

- `media_type` in POST /v0/media must accept `audio/wav` (the natural working
  format before the final compression) and `audio/mpeg` alongside `audio/mp3`,
  which is not a registered MIME type. See Prompt D: if you do them together,
  do it once.
- The audio domain's errors must say **which** reference was not resolved and
  by what criterion it was looked up. A 400 «file not found» with nothing else
  does not let a client tell «I used the wrong field» from «the file is not
  there» — it has already happened on the content domain.
- Declare explicitly which formats each operation accepts. If a format is not
  supported, the error should say so: today the client disables silence
  removal on wavs by itself, based on a rule read in the service's code, which
  is exactly the kind of knowledge that should not live in a client.

--- HOW IT IS VERIFIED -----------------------------------------------------

1. A synthetic file with two speakers at very different levels (the test above
   can be rebuilt with ffmpeg): after `normalize`, the gap between turns under
   1 LU and the file at -16 LUFS +/-0.5. Measure with `ffmpeg -af ebur128`, do
   not trust the 200.
2. The same source, two `silence` runs in a row with different thresholds:
   both must succeed without uploading the file again. It is the test that
   demonstrates point 2 of the model.
3. `normalize` then `silence`, and `silence` then `normalize`: both orders must
   complete. The quality will differ — the documentation says which to prefer —
   but neither may break.
4. An m4a and a wav must go through `silence` with no preliminary conversion on
   the caller's part.
5. A restart of the service with a job in progress: the job must still be
   queryable.
6. A comparison with the old service on the same file: the result must be at
   least as good. If it is worse, it is a regression even if the API is nicer.

OUT OF SCOPE
Blossom, Nostr and anything to do with the client: this is about building APIs.
No change to microservices-media, for any reason.
```

### Prompt D — Finish the `social` generator and the formats

```
Repository: microservice-media-manager, contract-first, branch develop.

1. `POST /v0/content/image` with `tipo: social` answers 501: the SocialRequest
   schema exists (1080×1080, logo_top, logo_bottom, text, bottom text,
   colours) but the generator is not written. Implement it by reusing the
   layer engine that already exists for `composita`, instead of a second code
   path: `social` becomes a preset that composes the layers.
2. Add a `tipo: slide` (or an equivalent preset) for the 16:9 video-cover
   format: it is the use case covered by hand today with `composita`.
3. The format contract, `media_type` in POST /v0/media. The current enum is
   `audio/m4a, audio/mp3, video/mp4, image/png, image/jpeg, image/webp` and
   has three problems:
   - `audio/mp3` is not a registered MIME type: the right one is `audio/mpeg`.
     Accept both and normalise, without breaking existing clients;
   - `font/ttf` and `font/otf` are missing, even though `content/image`
     accepts a font «uploaded to source»: today a font cannot be uploaded from
     the public domain;
   - `audio/wav` is missing, and it is the natural working format before the
     final compression.
4. `GET /v0/media` requires `type`: there is no way to list everything. There
   already is a `feature/list-all-media` branch; make it optional.
```

### Prompt E — Protected bytes and previews

```
Repository: microservice-media-manager.

`GET /v0/media/{id}/content` requires X-API-Key. The consequence for any
front-end: an `<img src="…/content">` gets a 401, because the browser does not
attach headers to subresource requests. Today the client has to download the
bytes with fetch and build an object URL — it works, but it keeps the image in
memory and does not make use of the HTTP cache.

Consider a signed, expiring read URL (a token in the query string, short
validity, read-only for that medium) to return in `content_url` alongside the
authenticated one. Do not make the bytes public by default.
```

---

### Prompt F — The podcasts' RSS feed (the `feed` domain)

Why it is needed: **nobody generates RSS from kind 54 events** — neither
Transmit nor njump — and without a feed the podcast does not exist for
Fountain, Apple, Podcast Index or any app that does not speak Nostr. The
client on GitHub Pages cannot serve it (it is static) and neither can Blossom
(the URL changes on every edit). It needs a media-manager domain, **public and
without a key**: podcast apps do not send `X-API-Key`.

```
Repository: microservice-media-manager, contract-first, branch develop.
A new public `feed` domain: one RSS 2.0 feed per Nostr podcast (NIP-F4),
generated from a key's kind 10154 and 54 events.

ENDPOINTS
  GET /v0/feed/health
  GET /v0/feed/{npub}.xml          -> application/rss+xml; charset=utf-8
      ?lang=it   (default: it)     the channel language: NIP-F4 has no field for it
      ?relays=wss://a,wss://b      to read in addition to the discovered ones
  {npub} in bech32 or 64 hex characters.

DIFFERENT FROM THE OTHER DOMAINS, AND IT MUST BE SAID IN THE CONTRACT
  - NO authentication: the feed is downloaded by podcast apps, which do not
    know about X-API-Key. The rest of the domains stay as they are.
  - Caching is mandatory: Cache-Control: public, max-age=300 and an ETag (a
    hash of the body); answer 304 to If-None-Match. Podcast Index re-reads
    every hour, Apple more often: without caching, every read queries the
    relays.
  - Per-IP rate limiting, because it is public.
  - Open CORS (Access-Control-Allow-Origin: *): the client checks it from the
    browser, and there is nothing to protect in a public feed.

WHERE IT READS FROM
  1. Relays: the key's NIP-65 list (kind 10002), taken from a set of indexer
     relays (purplepag.es, user.kindpag.es) plus a fixed fallback set
     (relay.damus.io, nos.lol, relay.primal.net), plus ?relays=.
     A feed that reads from the wrong relay is empty: it is the most likely
     defect, and the response must say which relays it queried in an XML
     comment at the top (<!-- relays: ... -->) so it can be diagnosed.
  2. Kind 10154 (one version, the most recent): without it -> 404 with the
     body {detail: "no podcast card (kind 10154) for this key on the relays
     queried", relays: [...]}. Do not invent a channel from kind 0.
  3. Kind 0: only for <itunes:author> and <itunes:owner>, if present.
  4. The key's kind 54 events, ordered by created_at descending. Zero
     episodes -> 200 with a channel and no items: an empty feed is valid.

MAPPING
  channel
    <title>            10154 title
    <description>      10154 description
    <link>             the first website tag; otherwise https://njump.me/<npub>
    <image><url>       10154 image   (also <itunes:image href>)
    <language>         ?lang, default it
    <itunes:author>    kind 0 name/display_name, otherwise the npub
    <itunes:explicit>  false (it does not exist in NIP-F4)
    <itunes:category>  omitted if unknown: do NOT invent one
    <podcast:guid>     UUIDv5 in the Podcasting 2.0 namespace
                       (ead4c236-bf58-58c6-a2c6-a6b28d128cb6) of the feed URL
                       without the scheme — that is how Podcast Index
                       deduplicates it; it must stay stable across responses
    <generator>        media-manager feed
    <atom:link rel="self">  the feed's own URL
  item, one per kind 54
    <title>            title
    <description>      description
    <content:encoded>  content (Markdown -> HTML, sanitised; if empty, description)
    <guid isPermaLink="false">  the event id
    <pubDate>          created_at in RFC 822
    <link>             https://njump.me/<nevent with a relay hint>
    <itunes:image>     image, if present
    <enclosure url type length>
                       url and type from the FIRST audio tag with an audio/*
                       MIME; length: it is NOT in the event (NIP-F4 has no
                       field for it). Get it with a HEAD on the URL,
                       Content-Length, with a persistent per-URL cache:
                       Blossom URLs are content-addressed, so the value never
                       changes. If the HEAD fails: length="0" and an XML
                       comment saying so; do not omit the enclosure.
    <itunes:duration>  omitted. It is not in the event and computing it costs
                       an ffprobe per episode; if it is ever done, with the
                       same per-URL cache.
  Audio tags beyond the first: <podcast:alternateEnclosure>, one each, if you
  like; otherwise ignore them. An episode with no audio tag with an audio/*
  MIME is skipped and counted in an XML comment at the end
  (<!-- skipped: N without audio -->).

CONTRACT AND VALIDITY TESTS
  - The feed passes the podcastindex.org validator (/validate) and
    castfeedvalidator: put at least an XML well-formedness check in CI, plus
    the presence of the tags Apple requires: title, description, language,
    itunes:image, itunes:explicit, and at least one item with an enclosure.
  - Fixture: three events (10154, 0, two 54s one of which has no audio) and
    the expected feed, compared ignoring whitespace.
  - A 304 with the right If-None-Match; an identical body for identical events
    (the ETag must not change if nothing changes: no generation timestamp in
    the body, or the ETag is useless).

OUT OF SCOPE
  No writing to Nostr. No automatic submission to Podcast Index: the user does
  that once, with the URL the client shows them.
```

**Verified on 13 September 2026 against the deployed domain**: a valid feed,
measured `length`s, ETag/304, CORS `*`, relays from the NIP-65 list. One defect
remains, and it is the subject of Prompt G.

### Prompt G — The feed's self-link should respect `X-Forwarded-Proto`

A delta on Prompt F, already carried out. A single correction.

```
Repository: microservice-media-manager, feed domain, branch develop.

THE DEFECT, VERIFIED
  GET https://mediamanager-dev.duckdns.org/v0/feed/<npub>.xml answers with
    <atom:link href="http://mediamanager-dev.duckdns.org/v0/feed/<npub>.xml" rel="self" .../>
  that is, in http, while the URL the feed is requested with — and submitted
  to Podcast Index with — is https. The service composes its own URL from the
  scheme the internal proxy reaches it with (http), not the one the world
  reaches it with.

CAUSE
  Two proxies in a row: the system nginx terminates TLS and sends
  X-Forwarded-Proto: https; the media-manager's proxy (deploy/proxy)
  overwrites it with its own $scheme, which is http. The app therefore never
  sees https.

THE FIX
  1. deploy/proxy/gen-nginx-conf.sh: proxy_set_header X-Forwarded-Proto must
     PROPAGATE the value it received when there is one, and use $scheme only
     when it is missing:
       map $http_x_forwarded_proto $outer_proto {
         default $http_x_forwarded_proto;
         ""      $scheme;
       }
       proxy_set_header X-Forwarded-Proto $outer_proto;
     This holds for every domain, not only feed: it is the same header anyone
     composing absolute URLs needs (media's signed_url, for instance).
  2. src/domains/feed: the URL of itself is composed from X-Forwarded-Proto
     and X-Forwarded-Host (or Host) — never from request.scheme — and must be
     used BOTH for <atom:link rel="self"> AND for the podcast:guid, which is
     the UUIDv5 of the URL without the scheme: today they coincide by
     accident, and they must coincide by construction.
  3. Tests: a request with X-Forwarded-Proto: https must produce an https
     self-link; without the header, the request's own scheme. The
     podcast:guid is the same in both cases (the scheme does not enter the
     guid).

LIVE CHECK
  curl -s https://mediamanager-dev.duckdns.org/v0/feed/<npub>.xml | grep atom:link
  must show href="https://…".
```

On the client side (in `main`): an «RSS feed» card in _Profile → RSS feed_
showing the URL for the active key, verifying it from the browser (downloading,
reading, summarising: how many episodes, the latest one, what is missing) and
explaining where to submit it. The client does not generate the feed: it
governs it.

### Prompt H — The feed reads what the platforms demand

Trying the feed against the real platforms (18 September 2026): Apple and
Amazon refuse a feed without `itunes:category`; Spotify, Amazon and YouTube
verify ownership by sending a code to the `itunes:email`, which is not there;
the W3C validator reports an `<itunes:owner>` without `<itunes:email>` as an
**error**. NIP-F4 provides for none of these fields, so the client writes them
in the 10154 with plain tags — and the service has to read them. This prompt is
the delta. Hand over **only the block** below.

```
Repository: microservice-media-manager, feed domain, branch develop.
A delta on Prompts F and G: read from kinds 10154 and 54 four pieces of data
that NIP-F4 does not provide for and that the client writes with tags of its
own. Updated fixtures, behaviour unchanged when the tags are absent.

NEW TAGS IN THE 10154 (all optional; the card stays valid without them)
  ["category", "News", "Daily News"]   main + optional sub-category, up to 3
                                       tags; the first is the primary category.
                                       Apple's EXACT names, with & unescaped.
  ["language", "it"]                   ISO 639-1
  ["email", "owner@example.tld"]
  ["content-warning", "…"]             NIP-36: its presence (even empty) = explicit

NEW TAGS IN THE 54 (optional)
  ["duration", "3600"]                 whole seconds
  ["content-warning", "…"]             the single episode's explicit flag

MAPPING
  category  -> <itunes:category text="News"><itunes:category text="Daily News"/></itunes:category>
               one per tag, in order; with & written &amp; in the attribute.
               No tag: NO <itunes:category> at all (do not invent "Technology").
  language  -> <language>: the tag wins over ?lang; ?lang wins over the "it" default.
  email     -> <itunes:owner><itunes:name>…</itunes:name><itunes:email>…</itunes:email></itunes:owner>
               WITHOUT an email: OMIT <itunes:owner> ENTIRELY. Today it comes out
               with only <itunes:name>, and for the W3C validator that is an error
               ("Missing itunes:owner element: itunes:email"). An empty owner is
               worse than no owner.
  content-warning in the 10154 -> <itunes:explicit>true</itunes:explicit>; absent -> false (as today)
  duration        in the 54    -> <itunes:duration>3600</itunes:duration>; absent -> omitted (as today)
  content-warning in the 54    -> <itunes:explicit>true</itunes:explicit> on the item; absent -> omitted
  podcast:alternateEnclosure   -> add length (HEAD on the URL, same cache as the enclosure)

TESTS
  - a fixture with a COMPLETE 10154 (3 categories, one of them with a sub-category
    and one with an &, language "en", email, content-warning) and one with NOTHING:
    both produce a feed that passes the W3C validator (feedvalidator.org /
    validator.w3.org/feed).
  - a 54 with duration and one without: the first has itunes:duration, the second
    does not.
  - ETag: for identical events the body does not change.
  - the category "Kids & Family" comes out as text="Kids &amp; Family".

OUT OF SCOPE
  No validation of category names against Apple's list: the client does that
  before publishing. The service reports what it finds.
```

### Prompt I — The audio comes out ready for players: CBR mp3 with ID3

Bitrate and ID3 tags live **in the file**, not in the feed: the RSS declares
only the MIME type (the enclosure's `type`) and, in Podcasting 2.0,
`bitrate`/`codecs` in the `alternateEnclosure`. So it is the `audio` domain —
which produces the files — that has to put them there. Hand over **only the
block**.

```
Repository: microservice-media-manager, audio domain, branch develop.
A delta on Prompt C: the mp3 produced by normalize/silence/convert must be the
one podcast players expect.

1. CONSTANT BITRATE. For format audio/mpeg encode in CBR at 128 kbps
   (`-b:a 128k`, no `-q:a`/VBR). Reason: many players estimate the duration
   from the first frame's bitrate, and with VBR the progress bar is wrong and
   the duration shown differs from the real one. Make the bitrate a job
   parameter (`bitrate_kbps`, default 128, allowed 64–320).

2. ID3v2.3 TAGS (not v2.4: v2.3 is the one everybody reads). Write:
     TIT2 (title)      from the job's `title`
     TPE1 (artist) and TALB (album)  from the new optional `show_title` field
     APIC (cover)      from the new optional `cover` field (a MediaRef to an
                       image in the archive), reduced to 1400×1400 JPEG
     TLEN (ms)         measured with ffprobe on the result
   With ffmpeg: `-id3v2_version 3 -metadata title=… -metadata artist=… -metadata album=…`
   and the cover as a second input with `-map 1 -disposition:v attached_pic`.
   If a field is missing, the corresponding tag is not written: no "Unknown".

3. CONTRACT. Add `bitrate_kbps`, `show_title` and `cover` (all optional) to
   normalize/silence/convert in openapi/audio/api.yaml, with the reason why in
   the description.

4. TESTS. A normalize job with show_title and cover: `ffprobe -show_format` on
   the result reports bit_rate 128000 (±2%), the title/artist/album tags and an
   attached_pic video stream. Without show_title: no TPE1/TALB.

OUT OF SCOPE
  ID3 on files uploaded directly by the user without processing: they do not go
  through the service, and bytes the user did not ask us to touch are not
  modified.
```

### Prompt J — The feed must not lose episodes because a relay is slow

Seen for real on 18 September 2026, right after publishing an episode: the feed
came out with **only the new episode**, the previous four gone. They were not
gone: they are on nos.lol, damus and primal, which at that moment did not
answer within the timeout, and the service cached the feed built from what had
arrived for five minutes. Whoever checks it at that moment believes they have
lost the episodes. It is a delta on H, to be handed over **separately** because
H has already been delivered. Only the block.

```
Repository: microservice-media-manager, feed domain, branch develop.
A delta on Prompt H, independent of it: a feed built without every relay's
answer must not stay cached for the full TTL.

WHAT HAPPENS TODAY
  relay_client._gather discards the relays that do not answer within
  FEED_RELAY_TIMEOUT_S (6 s) and returns what arrived; feed_service._generate
  builds the feed from those events and caches it for FEED_CACHE_TTL_S (300 s),
  with Cache-Control: max-age=300. If the relays holding the older episodes are
  slow, for five minutes the feed shows only the episodes that are also
  elsewhere. Observed: 1 episode out of 5.

WHAT SHOULD HAPPEN
  - RelayQueryResult already has queried and reached: if reached < queried, the
    result is PARTIAL.
  - a partial feed is cached for at most FEED_PARTIAL_CACHE_TTL_S (default 30),
    or not cached at all if the value is 0;
  - Cache-Control consistent with the cache: max-age=30 (or no-cache) for the
    partial feed, max-age=300 for the complete one;
  - in the <!-- relays: … --> comment the relays that did not answer must be
    marked, for example "wss://relay.damus.io (no answer)": it is the only way
    the client has of understanding why an episode is missing;
  - the partial feed comes out anyway, with the same body as before: better a
    feed with few episodes than a 503. Only how long it is kept changes.
  - optional, if it is cheap: when a relay times out, a second attempt with
    double the timeout before declaring it unreachable.

TESTS
  - a fake relay that does not answer: the feed comes out, the comment marks
    it, max-age=30, and on the next request (after 30 s, or immediately with
    TTL 0) it is regenerated.
  - every relay answers: today's behaviour, max-age=300, a stable ETag.
  - a partial feed and a complete one with the same events have the same ETag
    (the ETag is of the body, not of the cache).
```

### Prompt K — The feed carries the podcast's identity, not the service's

Moving a podcast to NMC from another host (Spotify for Creators, Anchor,
Buzzsprout…) must not look like a new podcast to the apps. Today it would: the
feed's `<guid>` is the event id, so every app sees the old episodes as removed
and new ones as added; `<pubDate>` is `created_at`, so every imported episode
is dated the day of the import; `<podcast:guid>` is computed from the
service's own URL, so Podcast Index (and Fountain, which reads from it) sees
another show. Analysed on 29 October 2026 on the real test feed
`https://anchor.fm/s/117e26658/podcast/rss`. The client now writes the data
the feed needs into the events; this prompt has the service read it. Every
rule falls back to today's behaviour when the tag is absent, so existing feeds
do not change. Only the block.

```
Repository: microservice-media-manager, feed domain, branch develop.
A delta on Prompts F, H and J. Every new tag is optional: when it is absent the
output is exactly today's (same body, same ETag).

KIND 54 (episode) — NEW TAGS
  ["i", "podcast:item:guid:<guid>"] + ["k", "podcast:item:guid"]   NIP-73
  ["published_at", "<unix seconds>"]
  ["season", "<n>"]  ["episode", "<n>"]  ["episode-type", "full|trailer|bonus"]
  ["transcript", "<url>", "<mime>"]                 zero or more
  ["chapters", "<url>", "application/json+chapters"]  at most one
  ["person", "<name>", "<role>", "<group>", "<img>", "<href>"]  trailing empties dropped
  ["value", "<type>", "<method>", "<suggested>"]
  ["value-recipient", "<name>", "<type>", "<address>", "<split>",
                      "<customKey>", "<customValue>", "<fee: true|''>"]

KIND 10154 (show) — NEW TAGS
  ["i", "podcast:guid:<uuid>"] + ["k", "podcast:guid"]   NIP-73
  ["feed", "<https url>"]        the feed's stable public address
  ["author", "<name>"]
  ["type", "episodic|serial"]
  ["value", …] ["value-recipient", …] ["person", …]   as in the 54
  ["funding", "<url>", "<text>"]

MAPPING
  item
    <guid isPermaLink="false">  the i tag's podcast:item:guid: value if present,
                                otherwise the event id (as today)
    <pubDate>                   published_at if present, otherwise created_at
    ORDER                       by that same date, newest first
    <itunes:season> <podcast:season>     season
    <itunes:episode> <podcast:episode>   episode
    <itunes:episodeType>        episode-type
    <podcast:transcript url type>        one per transcript tag
    <podcast:chapters url type>          chapters
    <podcast:person role group img href>name</podcast:person>
    <podcast:value>             with its <podcast:valueRecipient>s, from the 54's
                                value/value-recipient tags
  channel
    <podcast:guid>              the 10154's i tag podcast:guid: value if present,
                                otherwise today's UUIDv5
    <atom:link rel="self">      the 10154's feed tag if present, otherwise the
                                request URL (as today). Behind the creator's
                                reverse proxy the service sees its own host, not
                                the public one, so the true address can only
                                come from the card.
    <itunes:new-feed-url>       the 10154's feed tag, and ONLY when it is
                                present; otherwise not emitted (as today).
                                Apple moves a show to whatever new-feed-url
                                says: filled from the request URL, it would move
                                a proxied show to the service's technical
                                address, the very thing the stable address is
                                there to avoid.
    <itunes:author>             the author tag if present, otherwise the kind 0
    <itunes:owner><itunes:name> the same name (the email rule of Prompt H stays)
    <itunes:type>               type
    <podcast:value>             from the 10154's value tags
    <podcast:person>            from the 10154's person tags
    <podcast:funding url>text</podcast:funding>

  With type=serial the feed's order stays newest first: it is Apple that
  shows a serial oldest first, not the feed.

NOT TO DO
  - Do not validate the GUIDs' shape: an old host may use URLs or any string.
    Escape them, nothing more.
  - Do not compute podcast:guid from the feed tag: when the i tag is absent,
    keep today's computation. An identity must not change because an address
    was added.
  - CORS * and the ETag behaviour stay as they are: the creator's proxy
    forwards them, and NMC's address check runs from the browser.

TESTS
  - a fixture with every new tag on a 10154 and two 54s, against the expected
    feed (ignoring whitespace); the same fixture without the new tags gives
    today's feed byte for byte, and the same ETag.
  - two 54s whose published_at order is the opposite of their created_at order:
    the feed follows published_at.
  - a 54 with a non-UUID GUID (a URL with & in it): escaped, not rejected.
  - the feed tag set: atom:link self and itunes:new-feed-url both equal it,
    whatever the Host header of the request.
  - the feed tag absent: no itunes:new-feed-url at all, whatever the request.
```

## 4. From the old repository: what is worth porting

`microservices-media` (branch `dev`, service `ffmpeg`) exposes today:

| Endpoint                                       | Port it?         | Why                                                                                      |
| ---------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `POST /media/normalize`                        | **yes**          | Prompt C                                                                                 |
| `POST /media/remove_silence`                   | **yes**          | Prompt C                                                                                 |
| `POST /media/m4a_to_mp3`                       | yes, generalised | it becomes `/audio/convert`                                                              |
| `POST /media/split`                            | yes              | splitting a long episode into parts                                                      |
| `POST /media/concat`                           | yes              | intro + body + outro                                                                     |
| `GET /<base>/job/<id>`                         | **yes**          | the job model serves the whole audio domain                                              |
| `POST /voice/generation`                       | to be decided    | Piper speech synthesis: useful for a radio news bulletin, foreign to managing your media |
| `POST /voice/mixing`                           | to be decided    | only makes sense together with `voice/generation`                                        |
| `POST /media/clock/assemble`                   | no               | it assembles an hour of radio schedule: a different domain                               |
| `POST /radio/station*`, `POST /radio/playlist` | no               | they drive AzuraCast, nothing to do with this client                                     |

In the new repository there already are branches anticipating part of the work:
`feature/list-all-media`, `feature/content-custom-fonts`,
`feature/api-collections`, `infrastructure/source-download`,
`infrastructure/source-upload`, `infrastructure/media-bff`. Before opening new
work it is worth looking at them.

---

## 5. What the client does today

**One service, configured in one place.** The address and the key live in
_Settings → Processing service_, with the defaults taken from the environment
(`.env`, see `.env.example`). The Audio page shows only the features; if the
audio domain does not answer it says so with a pointer to the settings, where
the badges report the health of `media` and `audio` separately — because it is
normal, today, for the first to answer and the second not to.

The key stays **empty in the versioned defaults**: it is a credential, and
`NUXT_PUBLIC_*` ends up in the bundle served to the browser. Whoever develops
puts it in their own `.env`; the published site starts without it, and whoever
uses it enters it from the settings.

**Audio** (in `main`, under _Media → Audio_) — a local file, silence removal
with a threshold and a pause length set by sliders, levelling, comparison with
the original. At the end two exits: download, or «Publish as a podcast», which
carries the file into _Media → Upload to Blossom_ already in episode mode (kind
54), with resumable drafts and an exportable proposal to have another key sign.
Three things the new contract made possible, and they show on the page:

- **wavs are no longer excluded** from silence removal, and an m4a is no longer
  converted first: every operation accepts any reference;
- **the order is no longer imposed**. The client still does silences first and
  levelling second, but now it is a stated quality choice, not an
  infrastructure constraint;
- **the source survives**, so trying again with another threshold does not
  require uploading the file again — which is the most natural action in front
  of a slider.

**From the published site** (GitHub Pages, `https`) the page will only work
once the service answers over `https` with the CORS headers: while the
environment stays on `http`, the browser blocks the request as mixed content
and the page says so. In development, from `http://localhost`, it already
works.

**Process** (branch `feature/elabora-immagini`) — ingredients in the service's
archive, `copertina` or `composita` composition, preview, download or back to
Blossom. Its UX needs revising before it goes to `main`: you compose blind, the
ingredients disappear on reload, there are no thumbnails.

No feature was added: `analyze`, `split`, `concat`, the `social` and `slide`
presets and the font catalogue exist in the contract and do not yet have a
place in the interface.
