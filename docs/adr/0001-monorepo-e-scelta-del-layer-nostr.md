# ADR 0001 — Monorepo pnpm e scelta del layer Nostr

Data: 2026-08-24
Stato: accettato

## Contesto

Serve un client web Nostr con vocazione media, che copra le funzionalita'
social di base, i DM, il long-form e gli eventi da calendario NIP-52, e che
possa accogliere nuovi kind nel tempo senza rifattorizzazioni.

I candidati per il layer Nostr erano tre: NDK, applesauce, o solo nostr-tools.
Qualunque layer deve coprire connessioni, sottoscrizioni con deduplica, cache
locale, risoluzione replaceable/addressable, outbox model NIP-65 e signer.
I primi sei compiti li coprono tutti; il discriminante e' il settimo: **come
l'evento arriva al componente Vue**.

## Decisione

**applesauce 6.2.x + nostr-tools**, con un registry dei kind scritto da noi.

`applesauce-core` espone observable RxJS. In Vue diventano `ref` tramite
`@vueuse/rxjs`, quindi la reattivita' e' nativa e il ponte e' un composable di
poche righe. NDK avrebbe dato piu' cose pronte (outbox, cache, zap) ma espone
un EventEmitter e ha binding ufficiali solo per React e Svelte: per Vue il
wrapper reattivo andrebbe scritto comunque, e in cambio si erediterebbero le
sue convenzioni sui kind proprio dove vogliamo controllo esplicito.

**Monorepo pnpm** con tre package e un'app:

- `packages/nostr-core` — isomorfico, zero dipendenze da Vue. Ci vive il
  registry dei kind. Gira identico nel browser e in SSR.
- `packages/nostr-vue` — composables sopra il core.
- `packages/config` — configurazioni condivise.
- `apps/web` — Nuxt 4.

La separazione non e' cerimoniale: il core deve restare testabile in Node puro
e riutilizzabile lato SSR, e la regola `no-restricted-globals` in
`eslint.config.js` impedisce che vi rientrino `window` o `localStorage`.

## Conseguenze

- Aggiungere un kind = aggiungere un file in `kinds/definitions/` e
  registrarlo. Nessun altro file dell'app va toccato.
- Il costo e' un po' di assemblaggio iniziale che NDK avrebbe risparmiato.
- I servizi (relay, server Blossom) restano progetti esterni: qui si configura
  solo dove puntare. Vedi ADR 0003.
