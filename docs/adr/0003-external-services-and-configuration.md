# ADR 0003 — Relays and Blossom are external services

Date: 2026-08-24
Status: accepted

## Context

The client needs Nostr relays and at least one Blossom server for media. An
early idea was to develop them inside the monorepo, as `services/relay` and
`services/blossom`.

## Decision

**They are not developed here.** They are external projects; this repository
only knows _where to point_. The `services/` directory is therefore dropped
and what remains is three packages plus the app.

Endpoints come from environment variables (`.env.example` documents their
shape) and are read by `packages/nostr-core/src/config/defaults.ts`. Private
endpoints never enter the repository: `.env` is in `.gitignore`.

## A design constraint that is not negotiable

Every configured endpoint is a **first-run default, never a dependency**. The
user must be able to replace it from the settings and get a fully working
client pointing somewhere else, free endpoints included. Their choices are
then synchronised onto the relays through kind 10002 (NIP-65) and 10063
(Blossom BUD-03), which is to say they stay theirs and portable to other
clients.

If this constraint falls, we are building a centralised platform with a
decentralised protocol strapped on.

## Consequences

- No service to maintain, build or deploy in this repository.
- The `docker-compose.yml` that will appear for testing serves **only** the
  integration tests: it is not a product service.
- Payments for disk space stay outside v0 (Appendix A of the plan). The only
  hook present is that a `402` from a paid server must produce a readable
  error in the UI, not a crash.
- An empty `NUXT_PUBLIC_DRAFT_RELAY` disables saving drafts (kind 30024)
  instead of falling back to a public relay: a draft on a public relay is a
  publication nobody asked for.
