# ADR 0001 — pnpm monorepo and the choice of Nostr layer

Date: 2026-08-24
Status: accepted

## Context

We need a Nostr web client with a media vocation, covering the basic social
features, DMs, long-form and NIP-52 calendar events, and able to take on new
kinds over time without refactoring.

There were three candidates for the Nostr layer: NDK, applesauce, or
nostr-tools alone. Any layer has to cover connections, subscriptions with
deduplication, a local cache, replaceable/addressable resolution, the NIP-65
outbox model and signers. All three cover the first six; the deciding factor
is the seventh: **how the event reaches the Vue component**.

## Decision

**applesauce 6.2.x + nostr-tools**, with a kind registry of our own.

`applesauce-core` exposes RxJS observables. In Vue they become `ref`s through
`@vueuse/rxjs`, so reactivity is native and the bridge is a composable of a
few lines. NDK would have given us more off the shelf (outbox, cache, zaps)
but it exposes an EventEmitter and has official bindings only for React and
Svelte: for Vue the reactive wrapper would have to be written anyway, and in
exchange we would inherit its conventions about kinds exactly where we want
explicit control.

**pnpm monorepo** with three packages and one app:

- `packages/nostr-core` — isomorphic, no dependency on Vue. The kind registry
  lives here. It runs identically in the browser and in SSR.
- `packages/nostr-vue` — composables on top of the core.
- `packages/config` — shared configuration.
- `apps/web` — Nuxt 4.

The separation is not ceremonial: the core must stay testable in plain Node
and reusable server-side, and the `no-restricted-globals` rule in
`eslint.config.js` keeps `window` and `localStorage` out of it.

## Consequences

- Adding a kind = adding a file in `kinds/definitions/` and registering it.
  No other file in the app has to be touched.
- The cost is some initial assembly that NDK would have saved us.
- Services (relays, Blossom servers) stay external projects: here we only
  configure where to point. See ADR 0003.
