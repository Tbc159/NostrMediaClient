# ADR 0002 — applesauce 6.x, applesauce-factory banned, nostr-tools pinned

Date: 2026-08-24
Status: accepted · **enforced automatically** by `scripts/guard-deps.mjs`

## Context

The applesauce family is published as separate packages that have to stay
aligned on the same minor. Two details, verified on npm on 2026-08-24, break
that alignment silently.

### 1. `applesauce-factory` has fallen behind

```
applesauce-core        6.2.0     applesauce-loaders   6.2.0
applesauce-common      6.2.0     applesauce-signers   6.2.2
applesauce-relay       6.2.1     applesauce-accounts  6.2.0
applesauce-actions     6.2.0     applesauce-content   6.2.0

applesauce-factory     4.0.0  (dist-tag "latest", published 2025-09-30)
                       └── depends on applesauce-core@^4.3.0
```

Installing it alongside the others produces **two copies of applesauce-core**,
4 and 6. The failure is not a build error but a runtime bug: there are two
distinct identities of the `EventStore` class, so `instanceof` checks fail and
events put into one store never show up in the other. It is the kind of
problem that costs hours because it does not look like a dependency problem.

In 6.x the factories were absorbed into the core and are exposed as
**`applesauce-core/factories`**.

### 2. `nostr-tools` is pinned upstream

`applesauce-core` and `applesauce-relay` both declare:

```json
"nostr-tools": "~2.19"
```

which means `>=2.19.0 <2.20.0`. The `latest` on npm is 2.25.0: if a workspace
package asks for `^2.25`, pnpm installs **two copies** of nostr-tools. Here
too the failure is insidious, because nostr-tools exposes mostly pure
functions and the duplication does not blow up straight away.

## Decision

1. **`applesauce-factory` must never be added**, neither as a direct
   dependency nor through the catalog. Factories are imported from
   `applesauce-core/factories`.
2. **`nostr-tools` is pinned to `2.19.4`** (the highest patch compatible with
   `~2.19`), declared in the catalog in `pnpm-workspace.yaml`. Workspace
   packages reference it with `catalog:`, never with a range of their own.
3. applesauce versions all live **in the catalog**, so alignment is updated in
   one place.

## Automatic enforcement

The decision does not rely on the memory of whoever writes the code:

- **`scripts/guard-deps.mjs`** (`pnpm guard:deps`, part of `pnpm verify` and
  of CI) fails if `applesauce-factory` appears in any manifest or in the
  catalog, if `nostr-tools` is declared with a range other than the pin, or if
  after install `node_modules/.pnpm` holds more than one version of
  `applesauce-core` or `nostr-tools`.
- **`eslint.config.js`** forbids importing `applesauce-factory` through
  `no-restricted-imports`, catching it even if the package came in as a
  transitive dependency.

## When to revisit

When `applesauce-factory` is published aligned with 6.x — if it ever is, given
that factories now live in the core — or when applesauce widens its constraint
on nostr-tools. In that case: raise the pin in the catalog, update `PINNED` in
`guard-deps.mjs` and run `pnpm verify` again.
