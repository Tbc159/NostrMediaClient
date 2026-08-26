# ADR 0003 — Relay e Blossom sono servizi esterni

Data: 2026-08-24
Stato: accettato

## Contesto

Il client ha bisogno di relay Nostr e di almeno un server Blossom per i media.
Una prima ipotesi prevedeva di svilupparli dentro il monorepo, come
`services/relay` e `services/blossom`.

## Decisione

**Non si sviluppano qui.** Sono progetti esterni; il repository si limita a
sapere _dove puntare_. Cade quindi la cartella `services/` e restano tre
package piu' l'app.

Gli endpoint arrivano da variabili d'ambiente (`.env.example` ne documenta la
forma) e vengono letti da `packages/nostr-core/src/config/defaults.ts`. I
puntamenti privati non entrano mai nel repository: `.env` e' in `.gitignore`.

## Vincolo di design non negoziabile

Ogni endpoint configurato e' un **default di primo avvio, mai una dipendenza**.
L'utente deve poterlo sostituire dalle impostazioni e ottenere un client
pienamente funzionante puntando altrove, compresi endpoint gratuiti. Le sue
scelte si sincronizzano poi sui relay via kind 10002 (NIP-65) e 10063
(Blossom BUD-03), cioe' restano sue e portabili su altri client.

Se questo vincolo cade, stiamo costruendo una piattaforma centralizzata con un
protocollo decentralizzato addosso.

## Conseguenze

- Nessun servizio da mantenere, buildare o deployare in questo repository.
- Il `docker-compose.yml` che comparira' per i test serve **solo** ai test di
  integrazione: non e' un servizio di prodotto.
- I pagamenti per lo spazio disco restano fuori dalla v0 (Appendice A del
  piano). L'unico aggancio presente e' che una risposta `402` da un server a
  pagamento deve produrre un errore leggibile in UI, non un crash.
- `NUXT_PUBLIC_DRAFT_RELAY` vuoto disabilita il salvataggio delle bozze
  (kind 30024) invece di ripiegare su un relay pubblico: una bozza su relay
  pubblico e' una pubblicazione non voluta.
