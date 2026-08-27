# Stato di avanzamento

File di ripresa: dice dove siamo, cosa manca e come rimettere in piedi
l'ambiente. Va aggiornato alla fine di ogni blocco di lavoro, non alla fine
della fase — serve proprio a sopravvivere alle interruzioni a meta'.

Piano di riferimento: `~/.claude/plans/vorrei-sviluppare-un-client-virtual-pascal.md`

---

## Ripristino ambiente (da rifare a ogni nuova shell)

Node e pnpm vivono sotto nvm e **non** sono nel PATH di default: la shell di
sistema ha ancora Node 18, che non basta (Vite 8 richiede >= 20.19).

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22; hash -r
node -v   # atteso v22.23.2
pnpm -v   # atteso 11.23.0
```

### Gestione del client

`scripts/client.sh` carica nvm da solo: **questi comandi funzionano in una
shell qualsiasi**, senza preparare l'ambiente a mano.

```bash
pnpm start            # avvia in background, torna al prompt in ~10s
pnpm status           # stato + configurazione attualmente letta da .env
pnpm restart          # riavvia: serve dopo OGNI modifica a .env
pnpm stop             # ferma
pnpm logs             # segue il log (Ctrl-C per uscire)

./scripts/client.sh start 3210   # porta diversa
./scripts/client.sh fg           # primo piano, Ctrl-C per uscire
./scripts/client.sh check        # verifica endpoint da Node (niente CORS)
```

Il server legge `.env` **solo all'avvio**: modificarlo a caldo non ha effetto,
serve `pnpm restart`. Verificato sperimentalmente.

Stato e log stanno in `.run/` (ignorata da git). Se il PID file si perde,
`stop` chiude comunque chi occupa la porta.

### Verifica del repo

```bash
pnpm guard:deps        # trappole di dipendenza (ADR 0002)
pnpm check:endpoints   # verifica relay e Blossom da Node (niente CORS)
pnpm verify            # guard + format + lint + typecheck + test
pnpm build             # package + app Nuxt
```

Nota: lo script si chiama `check:endpoints` e non `doctor` perche' `pnpm doctor`
e' un comando interno di pnpm e avrebbe la precedenza.

---

## Fase 0 — scaffolding monorepo · COMPLETATA

| #   | Attivita'                                                | Stato                        |
| --- | -------------------------------------------------------- | ---------------------------- |
| 1   | Node 22 LTS via nvm                                      | fatto — v22.23.2             |
| 2   | pnpm via corepack                                        | fatto — 11.23.0              |
| 3   | `git init` su branch `main`                              | fatto — nessun commit ancora |
| 4   | Root: `package.json`, `pnpm-workspace.yaml`, `.npmrc`    | fatto                        |
| 5   | `tsconfig.base.json`, prettier, `eslint.config.js`       | fatto                        |
| 6   | `.gitignore`, `.env.example`                             | fatto                        |
| 7   | `scripts/guard-deps.mjs` + verifica che fallisca davvero | fatto                        |
| 8   | ADR 0001 / 0002 / 0003                                   | fatto                        |
| 9   | `packages/config` — preset tsconfig                      | fatto                        |
| 10  | `packages/nostr-core` — registry kind + config           | fatto                        |
| 11  | `packages/nostr-vue` — `useModel`                        | fatto                        |
| 12  | `apps/web` — Nuxt 4 + Tailwind 4                         | fatto                        |
| 13  | `.github/workflows/ci.yml`                               | fatto                        |
| 14  | `pnpm verify` e `pnpm build` verdi                       | fatto — 29 test passano      |

### Cosa e' gia' funzionante e verificato

- `pnpm verify` verde end-to-end: guard, prettier, eslint, typecheck sui tre
  progetti, 29 test.
- `pnpm build` produce l'output Nitro; il server buildato risponde 200 e
  serve il CSS Tailwind.
- **Guardia dipendenze provata in negativo**: introducendo `applesauce-factory`
  o allargando il range di `nostr-tools` lo script esce con codice 1 e spiega
  perche'. Non e' un controllo mai visto fallire.
- **Isolamento SSR gia' osservabile**: la route `/` (feed personale) e'
  `ssr: false`, e l'HTML servito contiene `data-ssr="false"` con
  `__NUXT_DATA__` ridotto a `[{"serverRendered":1},false]`. Nessuno stato di
  sessione nel payload, che e' la proprieta' della sezione 4 del piano.

### Scostamenti dal piano, decisi durante l'esecuzione

| Punto                               | Piano     | Realta'          | Perche'                                                                                                      |
| ----------------------------------- | --------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| pnpm                                | `pnpm@10` | `pnpm@11.23.0`   | linea corrente; la chiave `onlyBuiltDependencies` e' diventata `allowBuilds`                                 |
| `@nuxt/test-utils`                  | —         | `^4.1.0`         | la 3.x vuole Vitest 3, noi siamo su Vitest 4                                                                 |
| regola `consistent-type-imports`    | prevista  | **non attivata** | ridondante: `verbatimModuleSyntax` fa gia' rispettare la stessa cosa dal compilatore (TS1484), senza costi   |
| `no-undef` sui `.vue`               | —         | disattivata      | inciampa sugli auto-import di Nuxt; `nuxt typecheck` resta il controllo autorevole, come gia' fa per i `.ts` |
| `types: ["vite/client"]` nel preset | previsto  | rimosso          | i package libreria non hanno Vite fra le dipendenze                                                          |

---

## Fase GUI (branch `webapp/gui`) — schermate e form · IN CORSO

Fatto e verificato nel browser (Firefox headless via WebDriver, 22 controlli):

| Schermata                                  | Kind          | Stato                                       |
| ------------------------------------------ | ------------- | ------------------------------------------- |
| `/impostazioni` — accesso e configurazione | —             | fatto: NIP-07, chiave privata, sola lettura |
| `/scrivi` — composer nota                  | 1             | fatto: compone e firma                      |
| `/calendario/nuovo` — evento               | 31922 / 31923 | fatto: compone e firma, con fuso orario     |
| `/calendario` — elenco                     | —             | segnaposto: serve la lettura dai relay      |
| `/` — feed                                 | —             | segnaposto: serve la lettura dai relay      |

**I form producono eventi veri**, non finti: passano dal registry dei kind e si
fermano all'evento firmato. Quando arrivera' il pool di relay bastera'
aggiungere l'invio, senza rifare i form.

### Identita' — come si comporta

Tre modalita': estensione NIP-07 (consigliata), chiave privata cifrata NIP-49,
sola lettura. La chiave decifrata vive in una **variabile di modulo, fuori
dallo stato dello store**: non e' reattiva, non compare nei devtools e non puo'
finire nel payload SSR.

Conseguenza voluta e verificata: navigando fra le pagine la chiave resta
sbloccata, **una ricarica completa la richiude** e chiede di nuovo la password.

### Revisione su NIP-52 (segnalazione dell'utente)

Rilettura della specifica corrente. Quattro scostamenti corretti:

1. **Tag `D` mancante** — obbligatorio per il kind 31923: indice giornaliero
   `floor(unix_seconds / 86400)`, con un tag per ogni giorno coperto.
   **Non** si applica al 31922, dove la specifica elenca solo `start` ed `end`.
2. **`location` e' ripetibile**: un incontro puo' avere insieme un indirizzo e
   un link alla videochiamata.
3. **`p` porta relay e ruolo** in terza e quarta posizione, non solo la pubkey.
4. **`end` va confrontato in senso stretto**: la specifica dice «start must be
   less than end», quindi una fine uguale all'inizio va rifiutata.

Aggiunto anche il tag `a` verso i calendari (kind 31924).

Nota sul tag `D`: e' ancorato a UTC, perche' la formula usa solo il timestamp.
Un evento alle 23:00 a Tokyo cade quindi nel giorno UTC precedente. Introdurre
il fuso nel calcolo produrrebbe indici incompatibili con gli altri client.

### Bug trovati solo dal test nel browser

Tre difetti sono passati indenni sia da `nuxt typecheck` sia da eslint, ed e'
la ragione per cui il test end-to-end non e' sostituibile da quelli statici:

1. **`BaseButton` con `to` era inerte.** `<component :is="'NuxtLink'">` non
   risolve il componente e genera un elemento `<nuxtlink>` letterale, senza
   href ne' navigazione. Tutti i pulsanti-link erano morti. Serve
   `resolveComponent('NuxtLink')`.
2. **Espressione di template non valida.** Un `@click` con due istruzioni su
   righe separate, e un `as const` dentro un `v-for`: le espressioni dei
   template Vue sono JavaScript puro, non TypeScript. La pagina impostazioni
   non si caricava affatto.
3. **Il form calendario partiva non valido.** Attivando "tutto il giorno" la
   data di fine restava uguale a quella di inizio, che NIP-52 rifiuta perche'
   la fine e' esclusiva. Ora scatta al giorno successivo.

---

## Prossimo passo: Fase 1

Costruire il contenuto vero di `nostr-core` sopra lo scheletro esistente:

1. `relays/` — RelayPool su `applesauce-relay`, risolutore outbox NIP-65,
   lettura NIP-11, AUTH NIP-42.
2. `store/` — EventStore di `applesauce-core` con cache Dexie lato client.
3. `signers/` — NIP-07, NIP-46 bunker, NIP-49; gestione account.
4. Prime `kinds/definitions/`: 0, 1, 3, 5, 10002.
5. `nostr-vue`: `useAccount`, `useProfile`, `useEvent`, `useTimeline`.

Il registry (`kinds/registry.ts`) e le sue invarianti sono gia' pronti e
coperti da test: le definizioni si agganciano li' senza altre modifiche.

---

## Fasi successive (dal piano)

| Fase | Contenuto                                                                                 |
| ---- | ----------------------------------------------------------------------------------------- |
| 2    | Auth NIP-07/46, profilo (0), follow (3), relay list (10002 + migrazione da 2)             |
| 3    | Feed: note (1), repost (6/16), reazioni (7), commenti (1111), composer, cancellazione (5) |
| 4    | Media: Blossom BUD-01/02/06, imeta, kind 20/21/22/1063                                    |
| 5    | Long-form 30023/30024, editor Markdown, SSR + Open Graph + RSS                            |
| 6    | Calendario 31922-31925, RSVP, timezone                                                    |
| 7    | DM: lettura kind 4 + invio NIP-17 (1059/13/14) + relay list 10050                         |
| 8    | PWA, i18n, accessibilita', hardening                                                      |

I pagamenti restano **fuori dalla v0**: vedi Appendice A del piano.

---

## Configurazione endpoint — verificata dal browser

`.env` vive nella **radice del monorepo**, non in `apps/web`. Nuxt non lo
troverebbe da solo: gli script `dev`/`build`/`preview` di `apps/web` passano
quindi `--dotenv ../../.env`. Senza quel flag il runtimeConfig resta vuoto e la
diagnostica mostra endpoint sbagliati.

Due strumenti, **una sola logica** (`packages/nostr-core/src/relays/probe.ts`,
isomorfico): CLI e browser danno per costruzione la stessa diagnosi.

```bash
pnpm check:endpoints            # da Node, non subisce CORS
pnpm dev  →  /diagnostica       # dal browser, subisce CORS come l'app vera
```

Esito: **8 endpoint su 8 raggiungibili**, verificati dal browser con Firefox
headless pilotato via WebDriver.

La pagina mostra l'orario dell'ultima verifica accanto al riepilogo: senza,
una scheda lasciata aperta mostra risultati vecchi indistinguibili da quelli
freschi, e dopo un `restart` sembra che un endpoint sia caduto quando invece
e' solo la pagina a essere scaduta.

| Endpoint                             | Ruolo              | Note                                                       |
| ------------------------------------ | ------------------ | ---------------------------------------------------------- |
| `wss://relay.damus.io`               | lettura, scrittura | **intermittente**, rate limit per IP                       |
| `wss://nos.lol`                      | lettura, scrittura | stabile, ~200 ms                                           |
| `wss://relay.primal.net`             | lettura            | dichiara NIP-22                                            |
| `wss://purplepag.es`                 | indicizzatore      | dichiara NIP-42                                            |
| `wss://user.kindpag.es`              | indicizzatore      | dichiara NIP-22                                            |
| `https://blossom.yakihonne.com`      | media (primario)   | BUD-01 ok; `HEAD /upload` → **403**                        |
| `https://nostr.download`             | media (mirror)     | BUD-01 ok; `HEAD /upload` → 401                            |
| `wss://21milionidinostr.duckdns.org` | bozze (30024)      | strfry, cert Let's Encrypt valido; 6/6 sonde ok, 59-195 ms |

### Cosa e' emerso, e conta per le fasi successive

- **CORS decide quali server Blossom sono usabili.** `blossom.primal.net`, il
  default iniziale, manda `Access-Control-Allow-Origin` sul preflight `OPTIONS`
  ma **non sulla risposta `GET` effettiva**: da Node funziona, dal browser il
  fetch viene bloccato. Era invisibile finche' si testava solo da CLI.
- **`Access-Control-Expose-Headers` decide se possiamo leggere gli errori.**
  Blossom spiega i rifiuti nell'header `X-Reason`; senza quell'header il
  JavaScript vede il fallimento ma non il motivo. Solo `nostr.download` lo
  espone fra quelli provati.
- **`blossom.yakihonne.com` risponde 403 a `HEAD /upload`, non 401.** 401 vuol
  dire "serve autenticazione", 403 "non ti e' permesso": potrebbe limitare gli
  upload a pubkey autorizzate. Da riverificare in Fase 4 con un evento kind
  24242 firmato, che e' l'unica prova conclusiva.
- **Nessun relay dichiara NIP-65** nel proprio NIP-11. Non e' bloccante: NIP-65
  lo implementa il client. Significa pero' che le relay list vanno cercate sugli
  indicizzatori.
- `redirect: 'manual'` non e' utilizzabile nel browser (produce risposte
  opaqueredirect illeggibili) e molti server Blossom rispondono 302 verso una
  CDN: la sonda usa `redirect: 'follow'`.

---

## Punti aperti che aspettano l'utente

- **Endpoint privati** di relay e server Blossom: non ancora forniti. I default
  attuali sono relay pubblici verificati; quando arriveranno i tuoi, basta
  sostituirli in `.env` e rilanciare `pnpm check:endpoints`.
- **`NUXT_PUBLIC_DRAFT_RELAY` vuoto**: il salvataggio bozze (kind 30024) resta
  disabilitato di proposito, invece di mandarle su un relay pubblico (ADR 0003).
  Serve un relay privato o autenticato.
- **Primo commit git**: non ancora fatto, in attesa di conferma esplicita.
