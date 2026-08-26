# ADR 0002 — applesauce 6.x, divieto di applesauce-factory, pin di nostr-tools

Data: 2026-08-24
Stato: accettato · **applicato automaticamente** da `scripts/guard-deps.mjs`

## Contesto

La famiglia applesauce e' pubblicata come pacchetti separati che devono
restare allineati sulla stessa minor. Due dettagli, verificati su npm il
2026-08-24, rompono l'allineamento in modo silenzioso.

### 1. `applesauce-factory` e' rimasto indietro

```
applesauce-core        6.2.0     applesauce-loaders   6.2.0
applesauce-common      6.2.0     applesauce-signers   6.2.2
applesauce-relay       6.2.1     applesauce-accounts  6.2.0
applesauce-actions     6.2.0     applesauce-content   6.2.0

applesauce-factory     4.0.0  (dist-tag "latest", pubblicato 2025-09-30)
                       └── dipende da applesauce-core@^4.3.0
```

Installarlo insieme agli altri produce **due copie di applesauce-core**, la 4
e la 6. Il guasto non e' un errore di build ma un bug a runtime: esistono due
identita' distinte della classe `EventStore`, quindi gli `instanceof`
falliscono e gli eventi inseriti in uno store non compaiono nell'altro. E' il
tipo di problema che costa ore perche' non assomiglia a un problema di
dipendenze.

Nella 6.x le factory sono state assorbite nel core ed esposte come
**`applesauce-core/factories`**.

### 2. `nostr-tools` e' pinnato a monte

`applesauce-core` e `applesauce-relay` dichiarano entrambi:

```json
"nostr-tools": "~2.19"
```

che significa `>=2.19.0 <2.20.0`. La `latest` su npm e' la 2.25.0: se un
package del workspace chiede `^2.25`, pnpm installa **due copie** di
nostr-tools. Anche qui il guasto e' subdolo, perche' nostr-tools espone
soprattutto funzioni pure e la duplicazione non esplode subito.

## Decisione

1. **`applesauce-factory` non va mai aggiunto**, ne' come dipendenza diretta
   ne' via catalog. Le factory si importano da `applesauce-core/factories`.
2. **`nostr-tools` e' pinnato a `2.19.4`** (patch piu' alta compatibile con
   `~2.19`), dichiarata nel catalog di `pnpm-workspace.yaml`. I package del
   workspace la referenziano con `catalog:`, mai con un range proprio.
3. Le versioni applesauce stanno **tutte nel catalog**, cosi' l'allineamento
   si aggiorna in un punto solo.

## Applicazione automatica

La decisione non e' affidata alla memoria di chi scrive codice:

- **`scripts/guard-deps.mjs`** (`pnpm guard:deps`, incluso in `pnpm verify` e
  in CI) fallisce se `applesauce-factory` compare in un qualsiasi manifest o
  nel catalog, se `nostr-tools` e' dichiarato con un range diverso dal pin, o
  se dopo l'install `node_modules/.pnpm` contiene piu' di una versione di
  `applesauce-core` o `nostr-tools`.
- **`eslint.config.js`** vieta l'import di `applesauce-factory` con
  `no-restricted-imports`, intercettandolo anche se il pacchetto entrasse
  come dipendenza transitiva.

## Quando rivedere

Quando `applesauce-factory` verra' pubblicato allineato alla 6.x — se mai
accadra', dato che le factory sono ormai nel core — oppure quando applesauce
allarghera' il vincolo su nostr-tools. In quel caso: alzare il pin nel
catalog, aggiornare `PINNED` in `guard-deps.mjs` e rifare girare `pnpm verify`.
