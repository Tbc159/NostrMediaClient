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

Fatto e verificato nel browser (Firefox headless via WebDriver):

Elenco aggiornato delle schermate: vedi «Sezioni disponibili» piu' sotto.

**I form producono eventi veri** e li consegnano ai relay configurati.

### Pubblicazione e lettura dai relay

Aggiunti in `nostr-core/src/relays/`: `pool.ts` (fabbrica del `RelayPool`),
`publish.ts` (invio con esito per relay), `request.ts` (lettura, deduplica,
ordinamento).

**Non esiste "pubblicato" in assoluto.** Esistono relay che hanno l'evento e
relay che no: niente transazione, niente rollback. Percio' l'esito e' un elenco
per relay, e la UI lo mostra cosi' com'e' invece di ridurlo a un booleano che
nasconderebbe meta' della verita'. La soglia di riuscita e' **un** relay: un
evento presente su uno solo e' comunque raggiungibile e replicabile, mentre
pretendere l'unanimita' farebbe fallire ogni pubblicazione con un relay giu'.

Tre punti non ovvi, tutti coperti da test:

1. **E' il booleano dell'OK a dire se l'evento e' stato accettato, non il
   prefisso.** NIP-01 mostra `pow:` e `duplicate:` anche su risposte positive:
   leggere solo il prefisso segnalerebbe come fallita una pubblicazione
   riuscita.
2. **`duplicate` e' un successo.** Il relay ce l'ha gia': per chi pubblica il
   risultato e' identico a un'accettazione. Ripubblicare non duplica nulla.
3. **Un relay che pretende NIP-42 lascia la publish _in attesa_**, non la
   rifiuta. Senza una scadenza esplicita il pulsante girerebbe per sempre; con
   essa si arriva a un messaggio che dice cosa fare.

**L'autenticazione NIP-42 si usa solo in scrittura, mai in lettura.** Quando
consegni al relay un evento gia' firmato con la tua chiave, autenticarti non
gli rivela nulla di nuovo. Farlo in lettura gli direbbe invece _cosa leggi e
quando_, che e' informazione che non ha ragione di avere.

In lettura vale la regola opposta all'errore: un relay che non risponde non fa
fallire la lettura dagli altri: si restituisce quello che e' arrivato entro la
scadenza. Un feed con tre note su cinque e' utile, uno in errore no.

Gli eventi letti passano da `ultimaVersione()`: relay diversi possono avere
versioni diverse dello stesso evento addressable, e senza quel passaggio la
stessa riunione comparirebbe due volte in calendario, una col titolo vecchio e
una col nuovo. Lo spareggio a parita' di `created_at` e' l'id minore, come
prescrive NIP-01 — non e' estetica, e' cio' che fa convergere client diversi
sulla stessa versione.

Il calendario ordina per **data dell'evento**, non per data di pubblicazione:
in un calendario interessa quando l'evento accade, non quando e' stato scritto.

### Sezioni disponibili

| Rotta             | Kind             | Cosa fa                                                    |
| ----------------- | ---------------- | ---------------------------------------------------------- |
| `/`               | tutti            | i tuoi eventi, con filtro per tipo                         |
| `/scrivi`         | 1                | composer, firma e pubblica                                 |
| `/media`          | 20, 21, 22, 1063 | i tuoi media                                               |
| `/media/nuovo`    | idem             | upload Blossom, anteprima, `imeta`, pubblicazione          |
| `/articoli`       | 30023, 30024     | i tuoi articoli, con le bozze locali                       |
| `/articoli/nuovo` | 30023            | editor Markdown con anteprima sanificata                   |
| `/calendario`     | 31922, 31923     | i tuoi eventi, divisi in programma / gia' svolti           |
| `/impostazioni`   | —                | accesso, endpoint modificabili, strategia di pubblicazione |
| `/diagnostica`    | —                | verifica di relay e server Blossom                         |

La schermata `/` mostra **ogni kind che il client sa pubblicare**, con i filtri
per tipo e i relativi conteggi. L'elenco arriva da `publishableKinds()` e non da
una lista scritta a mano: registrare un kind nuovo lo fa comparire li' senza
toccare la pagina, che e' il punto dell'intera struttura dei kind.

Restano fuori gli **effimeri**, e non per prudenza: NIP-01 dice ai relay di non
conservarli, quindi interrogarli restituirebbe sempre il vuoto. Il kind 24242 di
Blossom e' l'esempio — viene firmato e spedito, ma dentro un header HTTP.

Il filtro lavora su quanto e' gia' stato letto, senza tornare ai relay: gli
eventi sono gia' tutti in pagina, e una seconda interrogazione aggiungerebbe
attesa per mostrarne un sottoinsieme.

**Tutti gli elenchi mostrano solo gli eventi dell'identita' attiva.** E' una
scelta, non una limitazione temporanea travestita: senza la lista dei follow
(kind 3) e senza il modello outbox (NIP-65), un elenco "di tutti" sarebbe _cio'
che passa dai relay configurati_ — una fetta arbitraria della rete, diversa a
ogni ricarica. I propri eventi sono un insieme che l'utente riconosce.

### Il guasto con le estensioni NIP-07 (nos2x, Alby)

Segnalato dall'utente: firmando con nos2x arrivava

```
Failed to execute 'postMessage' on 'Window': #<Object> could not be cloned.
```

Sembra un guasto dell'estensione e non lo e'. Le estensioni NIP-07 **non vivono
nella pagina**: il codice iniettato passa l'evento al proprio content script con
`window.postMessage`, che copia l'oggetto con lo **structured clone**. Lo
structured clone rifiuta i `Proxy`, e un template composto in un form vive
dentro un `ref`, che in Vue avvolge in un proxy reattivo qualunque oggetto ci si
metta dentro. La firma falliva quindi _prima_ che l'estensione la vedesse.

Rimedio: `plainEventTemplate()` in `nostr-core/src/identity/keys.ts`, applicata
in `identity.ts` prima di consegnare il template a chiunque firmi. La
ricostruzione e' esplicita — dice cosa riceve l'estensione, non lega il dominio
a Vue, e ricopia anche i tag, che sono array annidati: appiattire solo il
livello esterno lascerebbe proxy piu' in profondita'.

Verificato in entrambe le direzioni: reintroducendo il difetto il test nel
browser lo riproduce (Firefox e' anche piu' esplicito — «Proxy object could not
be cloned»), con la correzione passa.

**Difetto vicino, trovato di conseguenza:** `estensioneDisponibile` era un
`computed` senza dipendenze reattive, quindi valutato una volta sola. Le
estensioni iniettano `window.nostr` in modo asincrono e possono arrivare dopo
l'avvio dell'applicazione, lasciando l'utente davanti a «nessuna estensione
rilevata» che una ricarica smentisce. Ora e' un `ref` ricontrollato all'avvio,
con qualche tentativo ravvicinato, e di nuovo all'apertura delle impostazioni.

### Endpoint modificabili dall'interfaccia

Gli endpoint del `.env` restano quello che il piano dice che sono — default di
primo avvio — e da `/impostazioni` si sostituiscono senza riavviare il client.
La scelta vive in `localStorage`, quindi in quel browser e non nel repository.

La sovrapposizione avviene sulla forma **grezza** dell'ambiente e non
sull'oggetto gia' validato: cosi' la validazione resta quella sola di
`resolveClientConfig`, condivisa fra app, SSR e riga di comando. Il salvataggio
e' tutto-o-niente — accettare le modifiche valide e scartare le altre
lascerebbe una configurazione a meta', diversa da quella scritta, senza che
nulla lo dica.

### Pubblicazione a rotazione

Con piu' relay di scrittura il client ora li prova **uno per volta, in ordine,
fermandosi al primo che prende in carico l'evento**. Configurabile: la
strategia parallela resta disponibile dalle impostazioni.

Il motivo per cui la rotazione e' il default e' misurato, non teorico: aprendo
quattro WebSocket insieme se ne vedono fallire alcune, mentre una per volta
passano. Il compromesso va detto: a rotazione l'evento finisce su **un** relay,
quindi e' meno raggiungibile; in parallelo finisce ovunque, ma fallisce piu'
spesso.

I relay non contattati compaiono nel risultato marcati come tali, e non entrano
nel conteggio: altrimenti una pubblicazione andata come doveva si leggerebbe
«1 su 4».

**Difetto corretto nel frattempo:** un errore di connessione WebSocket
diventava il messaggio `[object ErrorEvent]`. rxjs propaga l'evento DOM, non un
`Error`, e i campi utili vanno estratti a mano — `CloseEvent` porta il codice,
`ErrorEvent` il messaggio.

### Media (Blossom)

`packages/nostr-core/src/media/blossom.ts` copre BUD-01/02/04/11. L'hash SHA-256
si calcola **nel client prima dell'invio** e viaggia in `X-SHA-256`: un `409`
dice che quel che e' arrivato non e' quel che si e' mandato, cosa che
altrimenti si scoprirebbe solo vedendo l'immagine rotta nel post pubblicato.

Il token BUD-11 (kind 24242) e' effimero e **non finisce mai su un relay**: sta
nell'header `Authorization`, in base64url senza padding. Dura cinque minuti,
perche' un token senza tag `server` e' spendibile su qualunque server Blossom
fino alla scadenza.

La replica sugli altri server non blocca: se fallisce, il file resta sul
primario. Trattarla come errore butterebbe un caricamento riuscito perche' un
server _secondario_ non risponde.

Invariante rispettata: **se il caricamento fallisce non si pubblica nulla**. Un
`imeta` che punta al vuoto resta pubblicato per sempre, e il kind 20 e'
regolare, quindi non correggibile.

### Long-form (NIP-23)

Editor Markdown con anteprima. Due cose che la specifica dice e che il codice
fa rispettare:

- **niente HTML nel Markdown** — il `build` lo rifiuta;
- **`created_at` e' l'ultima modifica, `published_at` la prima uscita**.
  Aggiornare il secondo a ogni salvataggio farebbe risalire l'articolo nei feed
  altrui a ogni correzione.

L'anteprima passa comunque da DOMPurify. Il divieto di HTML vincola _chi
scrive_, non chi legge: un evento arriva da un relay che non lo fa rispettare.

**Le bozze restano nel browser.** NIP-23 dichiara **deprecato il kind 30024** e
rimanda a NIP-37 (kind 31234, cifrato NIP-44 verso se stessi). Il 30024
finirebbe sul relay _in chiaro_: chiamarlo bozza e' fuorviante. Il 30024 resta
registrato in sola lettura, per non far sparire testi scritti con altri client.
NIP-37 e' il passo successivo ed e' **rimandato a un branch feature dedicato**,
per decisione dell'utente del 27 agosto 2026: il costo non e' il kind in se' ma
la cifratura NIP-44, da esporre in tutte e tre le modalita' di firma.

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

### Come si prova la pubblicazione senza scrivere su relay pubblici

`test/helpers/relay-finto.ts` avvia un relay NIP-01 minimo in-process (porta
assegnata dal sistema, quindi i test girano in parallelo). Non e' un mock del
pool: il traffico passa davvero da un WebSocket e da messaggi NIP-01 veri, che
e' l'unico modo per vedere i casi che contano — rifiuti, silenzi, sostituzione
degli addressable. Un mock proverebbe soltanto che il nostro codice chiama se
stesso.

Serve anche a non sporcare i relay pubblici con eventi di prova.

---

## Prossimo passo: Fase 1, il resto

Fatto in questo giro: `relays/` — pool, pubblicazione con esito per relay,
lettura con deduplica. Manca ancora:

1. `relays/` — risolutore outbox NIP-65 (kind 10002) e lettura NIP-11 nel pool.
   Finche' non c'e', "tutti" nel feed significa _quello che passa dai relay
   configurati_, non l'intera rete: la UI lo dice invece di far credere a una
   copertura che non ha.
2. `store/` — EventStore di `applesauce-core` con cache Dexie lato client. Oggi
   ogni cambio pagina rilegge dai relay: funziona, ma e' traffico sprecato.
3. `signers/` — NIP-46 bunker (NIP-07 e NIP-49 gia' fatti).
4. Restanti `kinds/definitions/`: 3 (follow), 5 (cancellazione), 10002.
5. `nostr-vue`: `useAccount`, `useProfile`, `useEvent` — `useTimeline` per ora
   vive in `apps/web`, va promosso quando serve a piu' di un'app.

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
