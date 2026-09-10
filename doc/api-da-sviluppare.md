# API da sviluppare sul microservizio media-manager

Documento di lavoro per NostrMediaClient. Raccoglie **cosa manca** al servizio
[`microservice-media-manager`](https://github.com/Tbc159/microservice-media-manager)
perché questo client possa usarlo, e i **prompt** da consegnare a un agente che
lavori su quel repository.

Tutto quanto segue è stato verificato il 6 settembre 2026 contro il branch
`develop` del repository e contro l'ambiente `http://mediamanager-dev.duckdns.org`.

---

## 1. Cosa c'è oggi

Il servizio è contract-first: la verità è in `openapi/<dominio>/api.yaml`. Sul
branch `develop` esistono tre domini; `main` ne ha uno solo, perché è un branch
d'ambiente.

| Dominio   | Esposto     | Operazioni                                                                                                                    |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `media`   | pubblico    | `GET /v0/media` (richiede `type`), `POST /v0/media` (multipart), `GET /v0/media/{id}`, `GET /v0/media/{id}/content`           |
| `content` | pubblico    | `POST /v0/content/image` — `tipo`: `copertina` (attivo), `composita` (attivo, motore a livelli 1920×1080), `social` (**501**) |
| `source`  | **interno** | archivio; include `POST /source/media/from-url`, non raggiungibile dall'esterno                                               |

Autenticazione: header `X-API-Key`. Il root del reverse proxy dichiara
«domini pubblici: content media», e infatti `/v0/source/health` risponde 404.

**Non esiste alcun endpoint audio.** I path `/yt/media/social` e `/yt/slide` non
esistono in questo repository: il nome viene dallo script client
`create_yt_media.py` del repository precedente, che orchestrava
`POST /media/normalize` e `POST /media/remove_silence` del servizio `ffmpeg`.

---

## 2. Due ostacoli che bloccano tutto, prima delle funzionalità

Verificati con `curl` contro l'ambiente di sviluppo.

**a. Nessuna intestazione CORS.** Una `GET /v0/media/health` con
`Origin: https://tbc159.github.io` torna senza `Access-Control-Allow-Origin`, e
il preflight `OPTIONS /v0/content/image` risponde `405 Method Not Allowed` con
`allow: POST`. Dal browser **ogni chiamata è bloccata prima di partire**: non è
un problema di rete né di chiave, e dal lato client si manifesta come «servizio
non raggiungibile» mentre da `curl` tutto funziona.

**b. Nessun HTTPS.** `https://mediamanager-dev.duckdns.org/` non risponde. Il
client pubblicato sta su GitHub Pages, quindi su `https`: una richiesta verso
`http` è **contenuto misto** e il browser la rifiuta a prescindere dal CORS.

Finché restano, la sezione «Elabora» del client funziona solo contro un
servizio locale.

---

## 3. Prompt per l'agente — in ordine di dipendenza

### Prompt A — Rendere il servizio utilizzabile da un browser (bloccante)

```
Lavori sul repository microservice-media-manager, contract-first (OpenAPI 3.0,
`openapi/<dominio>/api.yaml` è l'unica fonte di verità), branch develop →
staging.

Obiettivo: rendere i domini pubblici `media` e `content` chiamabili da
un'applicazione web servita su un'altra origine.

Stato verificato (6 settembre 2026, ambiente mediamanager-dev.duckdns.org):
- una GET /v0/media/health con header Origin non riceve alcun
  Access-Control-Allow-Origin;
- OPTIONS /v0/content/image risponde 405 con `allow: POST`, quindi il preflight
  fallisce;
- https:// sul dominio non risponde: c'è solo http.

Da fare:
1. CORS sui soli domini pubblici (`media`, `content`), non su `source`.
   Il preflight OPTIONS deve rispondere 204 e includere:
   - Access-Control-Allow-Origin: le origini configurate (elenco da variabile
     d'ambiente, non `*` una volta che si usano chiavi);
   - Access-Control-Allow-Headers: content-type, x-api-key;
   - Access-Control-Allow-Methods: GET, POST, OPTIONS;
   - Access-Control-Max-Age ragionevole.
   Valuta se metterlo in nginx (reverse proxy) o in Connexion/Flask: scegli uno
   solo dei due, perché intestazioni duplicate fanno fallire il preflight in
   modo difficile da diagnosticare.
2. HTTPS sul dominio di sviluppo (Let's Encrypt via DuckDNS), con redirect da
   http.
3. Un test di contratto che verifichi il preflight: OPTIONS su un endpoint
   pubblico deve tornare 204 con le tre intestazioni. È la regressione più
   facile da reintrodurre e la più difficile da notare, perché curl non la vede.

Vincolo: `source` deve restare non raggiungibile dall'esterno.
```

### Prompt B — Portare un asset dal suo URL, senza farlo passare dal browser

```
Repository: microservice-media-manager, contract-first, branch develop.

Contesto: il client tiene i file su Blossom (archivio a contenuto indirizzato
per hash, URL pubblici). Per elaborarli, oggi il browser deve scaricare i byte
da Blossom e ricaricarli con POST /v0/media in multipart: la banda si paga due
volte e i file grandi passano dalla memoria della pagina.

Nel dominio interno esiste già `POST /source/media/from-url`, dichiarato «uso
interno» e non esposto.

Da fare:
1. Esporre nel dominio pubblico `media` un `POST /v0/media/from-url` che accetti
   `{ url, title, media_type?, duration_s? }`, scarichi il contenuto lato
   server e crei il media, delegando a source.
2. Se `media_type` è assente, ricavarlo dal Content-Type della risposta; se il
   tipo non è fra quelli accettati, rispondere 400 dicendo quale è stato
   rilevato — non un 500.
3. Difese, perché l'URL arriva dall'esterno: consentire solo http/https,
   rifiutare gli indirizzi che risolvono su rete privata o loopback (SSRF),
   imporre un limite di dimensione e un timeout, non seguire più di N redirect.
4. Se il contenuto è già presente, rispondere 409 come fa POST /v0/media, così
   il client può riusare il record esistente invece di trattarlo come errore.
5. Test: URL valido, tipo non accettato, indirizzo su rete privata, file oltre
   il limite, duplicato.
```

### Decisione del 10 settembre 2026 — `microservices-media` è in dismissione

Il servizio `ffmpeg` del repository precedente **è vivo** su
`http://api-v0-bitcoinradio.duckdns.org` (un `GET` sulle rotte risponde `405`:
esistono e vogliono `POST`) e, a differenza del media-manager, **espone
correttamente il CORS** — il preflight risponde `200` con
`Access-Control-Allow-Origin`. È chiamabile da un browser oggi, purché la
pagina stia su `http`.

Il client lo usa già, nella sezione «Audio», attraverso l'interfaccia
`ServizioAudio` (`packages/nostr-core/src/audio/tipi.ts`): le pagine non
conoscono le rotte, le conosce solo l'adattatore `legacy.ts`.

**Da qui in avanti su quel repository non si interviene.** È in dismissione:
non riceve correzioni, non riceve funzionalità, e i suoi difetti non vanno
riparati là. Resta acceso finché il dominio audio del media-manager non è
pronto, e serve a due cose soltanto:

1. **implementazione di riferimento** — il comportamento da riprodurre si legge
   nel suo codice, con le misure già fatte;
2. **termine di paragone** — a port avvenuto, lo stesso file deve dare un
   risultato almeno pari.

Conseguenza per il client: i vincoli del servizio vecchio si continuano ad
**assorbire**, non a correggere. Sono documentati in `audio/legacy.ts` e sono
tre: le cartelle impongono l'ordine delle operazioni (un `mp3` caricato finisce
in `uploads/mp3_media`, `remove_silence` legge solo da lì e scrive in
`uploads/clean`, `normalize` scrive in `uploads/normalized`, quindi
normalizzare per primo spezza la catena); il taglio dei silenzi vale solo per
gli `mp3`; `stop_silence` non è esposto, quindi le pause vengono azzerate
invece che accorciate. Il Prompt C li elimina alla radice, **nel repository
nuovo**.

### Prompt C — Ricostruire il dominio audio nel media-manager

Prompt autosufficiente, da consegnare all'agente che sviluppa
`microservice-media-manager`. Sostituisce e assorbe il precedente Prompt C-bis.
Ogni affermazione qui dentro nasce da codice letto o da una misura eseguita,
mai da un'impressione: dove è una misura, sono riportati i numeri perché siano
ripetibili.

```
Repository: microservice-media-manager, contract-first (openapi/<dominio>/api.yaml
è l'unica fonte di verità), branch develop.

OBIETTIVO
Un nuovo dominio pubblico `audio`, che porti qui l'elaborazione audio oggi
disponibile solo nel repository precedente (microservices-media, branch dev,
servizio `ffmpeg`).

REGOLA DI PERIMETRO, VINCOLANTE
microservices-media è **in dismissione**. Non aprire PR, non correggere bug,
non aggiungere parametri là: nemmeno quelli che questo prompt descrive come
difetti. Quel codice si legge come riferimento e basta. Tutto il lavoro sta in
questo repository. Se ti accorgi che una funzione del vecchio servizio non è
descritta qui, segnalala invece di andarla a sistemare dove sta.

CHI CONSUMERÀ QUESTE API
Un client web (NostrMediaClient) che oggi parla col servizio vecchio dietro
un'interfaccia propria. Quando questo dominio esisterà, il client cambierà solo
l'adattatore: **non serve compatibilità con le rotte vecchie**, serve parità di
capacità. Le capacità che usa oggi, in ordine di flusso:
  1. manda un file audio (mp3, m4a o wav)
  2. toglie i silenzi, con soglia in dB e durata minima della pausa, entrambe
     regolate dall'utente con un cursore
  3. livella le voci e sceglie il formato di uscita
  4. segue l'avanzamento e può smettere di attendere
  5. riscarica il risultato per riascoltarlo accanto all'originale
Il client è servito da browser: **CORS e HTTPS valgono anche per questo
dominio** (Prompt A). Senza, dal browser non è chiamabile.

OPERAZIONI MINIME
  POST /v0/audio/normalize   livella il parlato
  POST /v0/audio/silence     accorcia i silenzi
  POST /v0/audio/convert     cambia contenitore/codec (sostituisce m4a_to_mp3)
  POST /v0/audio/analyze     misura e non modifica nulla (vedi §7)
  GET  /v0/audio/job/{id}    stato di una lavorazione
Dal servizio vecchio vale la pena portare anche `split` (dividere un episodio
lungo) e `concat` (sigla + corpo + coda). NON portare `radio/*`,
`media/clock/assemble` (palinsesto radio), `voice/generation` e `voice/mixing`
(sintesi vocale Piper): sono un altro dominio.

L'input è un media già presente nell'archivio (id o riferimento, come fa
`content`), non un upload dentro l'operazione: così la stessa sorgente si riusa
fra più tentativi. L'output è un nuovo media, e la risposta ne porta id e URL,
come fa GET /v0/content/image. Le lavorazioni sono lunghe: modello a job con
polling (POST -> 202 + job_id, GET .../job/{id} -> stato).

--- MODELLO: i sei vincoli da NON riprodurre -------------------------------

1. RIFERIMENTI AI FILE, NON UNA CARTELLA PER OPERAZIONE. È la causa di tutto il
   resto. Nel servizio vecchio `remove_silence` legge da CONVERTED_FOLDER
   (uploads/mp3_media) e scrive in CLEANED_FOLDER, mentre `normalize` scrive in
   NORMALIZED_FOLDER. Ne discendono due limiti senza alcuna ragione d'essere:
   - **l'ordine delle operazioni è obbligato**: normalizzando per primo, il
     file finisce in una cartella che il taglio dei silenzi non guarda e la
     catena si spezza (è quasi certamente perché in create_yt_media.py quel
     passaggio è commentato);
   - **il taglio dei silenzi vale solo per gli mp3**, perché legge dalla
     cartella degli mp3: un m4a va convertito prima, un wav non si può proprio.
   Qui ogni operazione deve accettare lo stesso tipo di riferimento e
   risolverlo allo stesso modo. Con questo, ordine libero e formati
   indifferenti — due limiti che spariscono senza scriverci una riga contro.

2. NON DISTRUGGERE L'INGRESSO. Nel vecchio, `remove_silence` fa
   `os.remove(input_file_path)`, e `m4a_to_mp3` pure. Conseguenza concreta, già
   visibile nel client: la pagina espone un cursore per la soglia del silenzio,
   e **riprovare con una soglia diversa è l'azione più naturale del mondo** —
   ma il file di partenza non esiste più e va ricaricato. Un'operazione produce
   un nuovo oggetto e lascia intatto quello di partenza; la pulizia è una
   politica di ritenzione, non un effetto collaterale.

3. NON RICOMPRIMERE A OGNI PASSAGGIO. La catena attuale su un mp3 fa tre
   generazioni lossy: l'originale, la ricodifica di `remove_silence` (che riusa
   codec e bitrate della sorgente) e quella di `normalize`. Le fasi intermedie
   lavorino senza perdita (wav o flac) e la compressione avvenga **solo
   nell'ultimo passaggio**, quello che produce il file consegnato.

4. TUTTE LE OPERAZIONI LUNGHE SIANO JOB. Nel vecchio `remove_silence` è
   sincrona mentre `normalize` e `m4a_to_mp3` sono asincrone. Su un file lungo
   la richiesta sincrona resta appesa finché non scade qualcosa — un proxy, il
   browser — e il client non può distinguere «sta lavorando» da «è morto».

5. I JOB SOPRAVVIVANO AL RIAVVIO. Nel vecchio `jobs` è un dizionario in memoria
   di processo: un riavvio perde i lavori in corso e più di un worker non può
   funzionare. Serve stato condiviso e persistente.

6. NIENTE `verify=False`. Nella `requests.get` di `normalize` la verifica del
   certificato TLS è disattivata. Se serve per un certificato interno, si
   aggiunga quella CA.

--- ELABORAZIONE: cosa fa ffmpeg, misurato ---------------------------------

Il codice esistente NON produce l'effetto desiderato, e la causa è stata
misurata. Catena attuale in ffmpeg/processors/ffmpeg_processor.py:

    -af dynaudnorm=f=500:g=31:p=0.95,loudnorm=I=-16:TP=-1.5:LRA=11

Prova eseguita (ffmpeg 6.1.1) su un file sintetico con due interlocutori
alternati, uno a -12 dBFS e uno a -30 dBFS, turni di 6 s e pause di 2 s,
misurando i LUFS integrati di ogni turno:

    sorgente                          scarto fra i due parlanti: 18.0 LU
    catena attuale                    scarto: 11.1 LU     <-- non li allinea
    dynaudnorm f=250 g=11 (m default) scarto: 11.6 LU
    speechnorm                        scarto: 14.8 LU
    dynaudnorm f=250 g=11 m=100       scarto:  0.2 LU     <-- allineati
    idem + loudnorm I=-16             scarto:  0.4 LU, file a -16 LUFS

Causa: `dynaudnorm` ha `maxgain` (m) con default **10**, cioè +20 dB. Con 18 LU
di differenza la voce debole ne chiederebbe ~30, viene tagliata a 20, e restano
gli ~11 LU misurati. Non è la finestra di smussamento: accorciarla non cambia
quasi nulla finché il tetto resta.

Effetto collaterale misurato, da non nascondere: con un fruscio di fondo a
-70 LUFS, alzando m il fondo nelle pause sale da -58 a -51 LUFS. Resta ~34 dB
sotto il programma, ma su registrazioni rumorose serve un gate o una riduzione
di rumore prima.

Quindi:
  a. `maxgain` sia un parametro dell'API, con default alto (50-100) e non il 10
     di ffmpeg; documentarlo come tetto di correzione in dB (20*log10 m).
  b. La pipeline consigliata è **prima i silenzi, poi la normalizzazione**.
     Misurato: normalizzando prima, l'amplificazione alza il rumore di fondo
     sopra la soglia di silenzio e la rimozione non lo riconosce più — sullo
     stesso file, 56.2 s contro 28.1 s di durata finale. Con il punto 1 del
     modello l'ordine non è più imposto dall'infrastruttura: resta una
     raccomandazione da scrivere nella documentazione dell'endpoint, che è il
     posto giusto per una scelta di qualità.
  c. `silenceremove` è oggi invocato come
     `stop_periods=-1:stop_duration=...:stop_threshold=...`, che **azzera** le
     pause e produce stacchi innaturali. Esporre `stop_silence` (quanto
     silenzio lasciare, es. 0.3 s) con un default che lasci una pausa udibile,
     e documentare che `stop_threshold` vuole un'unità (`-40dB`), altrimenti è
     ampiezza lineare. È il parametro che manca di più.
  d. Valutare `loudnorm` in due passate (misura, poi applica con `measured_*` e
     `linear=true`): in una passata sola lavora in modo dinamico e aggiunge una
     seconda compressione sopra a quella di dynaudnorm. Non è stato misurato:
     verificalo prima di deciderlo.
  e. Limite noto da dichiarare nell'API, non da risolvere: quando due voci si
     sovrappongono nello stesso canale nessuna di queste tecniche le separa. Se
     esistono tracce separate per parlante, normalizzarle singolarmente prima
     del missaggio dà un risultato molto migliore — valuta un endpoint che
     accetti più tracce.

--- 7. POST /v0/audio/analyze: la misura come funzione ---------------------

È l'endpoint che aiuta di più l'interfaccia, e non esiste da nessuna parte.
Restituisce, senza modificare nulla: loudness integrata (LUFS), true peak,
loudness range, **livello del rumore di fondo**, e la distribuzione delle
durate dei silenzi sopra alcune soglie.

Perché conta: oggi il client propone -40dB e 1s come default, e sono
ragionevoli *in generale*. Con la misura può proporre la soglia giusta **per
quella registrazione** — la differenza fra un cursore che si muove alla cieca e
uno che parte dal punto giusto. Un'analisi va anche riusata: il risultato
dev'essere associato al media, non ricalcolato a ogni apertura di pagina.

--- CONTRATTO ---------------------------------------------------------------

- `media_type` in POST /v0/media deve accettare `audio/wav` (formato di
  lavorazione naturale prima della compressione finale) e `audio/mpeg` accanto
  a `audio/mp3`, che non è un tipo MIME registrato. Vedi il Prompt D: se lo
  svolgi insieme, falli una volta sola.
- Gli errori del dominio audio devono dire **quale** riferimento non è stato
  risolto e con quale criterio è stato cercato. Un 400 «file non trovato» senza
  altro non permette a un client di distinguere «ho sbagliato campo» da «il
  file non c'è» — è già successo sul dominio content.
- Dichiarare esplicitamente i formati accettati per ciascuna operazione. Se un
  formato non è supportato, l'errore lo dica: il client oggi disabilita da sé
  il taglio dei silenzi sui wav basandosi su una regola letta nel codice del
  servizio, che è esattamente il genere di conoscenza che non dovrebbe stare in
  un client.

--- COME SI VERIFICA --------------------------------------------------------

1. File sintetico con due interlocutori a livelli molto diversi (la prova qui
   sopra si ricostruisce con ffmpeg): dopo `normalize`, lo scarto fra i turni
   sotto 1 LU e il file a -16 LUFS +/-0.5. Misurare con `ffmpeg -af ebur128`,
   non fidarsi del 200.
2. Stessa sorgente, due `silence` di fila con soglie diverse: entrambi devono
   riuscire senza ricaricare il file. È il test che dimostra il punto 2 del
   modello.
3. `normalize` poi `silence` e `silence` poi `normalize`: entrambi gli ordini
   devono completare. La qualità sarà diversa — la documentazione dice quale
   preferire — ma nessuno dei due deve rompersi.
4. Un m4a e un wav devono attraversare `silence` senza conversioni preliminari
   a carico del chiamante.
5. Un riavvio del servizio con un job in corso: il job dev'essere ancora
   interrogabile.
6. Confronto con il servizio vecchio sullo stesso file: il risultato dev'essere
   almeno pari. Se è peggiore, è una regressione anche se l'API è più bella.

FUORI PERIMETRO
Blossom, Nostr e qualunque cosa riguardi il client: qui si costruiscono API.
Nessuna modifica a microservices-media, per nessun motivo.
```

### Prompt D — Completare il generatore `social` e i formati

```
Repository: microservice-media-manager, contract-first, branch develop.

1. `POST /v0/content/image` con `tipo: social` risponde 501: lo schema
   SocialRequest esiste (1080×1080, logo_top, logo_bottom, testo, testo_bottom,
   colori) ma il generatore non è scritto. Implementarlo riusando il motore a
   livelli già esistente per `composita`, invece di un secondo percorso di
   codice: `social` diventa un preset che compone i livelli.
2. Aggiungere un `tipo: slide` (o un preset equivalente) per il formato 16:9 da
   copertina di video: è il caso d'uso che oggi si copre a mano con `composita`.
3. Contratto dei formati, `media_type` in POST /v0/media. L'enum attuale è
   `audio/m4a, audio/mp3, video/mp4, image/png, image/jpeg, image/webp` e ha tre
   problemi:
   - `audio/mp3` non è un tipo MIME registrato: quello giusto è `audio/mpeg`.
     Accettare entrambi e normalizzare, senza rompere i client esistenti;
   - mancano `font/ttf` e `font/otf`, benché `content/image` accetti un font
     «caricato su source»: oggi un font non si può caricare dal dominio
     pubblico;
   - manca `audio/wav`, che è il formato di lavorazione naturale prima della
     compressione finale.
4. `GET /v0/media` richiede `type`: non si può elencare tutto. C'è già un branch
   `feature/list-all-media`; renderlo opzionale.
```

### Prompt E — Byte protetti e anteprime

```
Repository: microservice-media-manager.

`GET /v0/media/{id}/content` richiede X-API-Key. Conseguenza per qualunque
front-end: un `<img src="…/content">` riceve 401, perché il browser non allega
intestazioni alle richieste di sottorisorsa. Oggi il client deve scaricare i
byte con fetch e costruire un object URL — funziona, ma tiene l'immagine in
memoria e non sfrutta la cache HTTP.

Valutare un URL di lettura firmato e a scadenza (token nella query string,
validità breve, sola lettura di quel media) da restituire in `content_url`
accanto a quello autenticato. Non rendere pubblici i byte per default.
```

---

## 4. Dal repository vecchio: cosa vale la pena portare

`microservices-media` (branch `dev`, servizio `ffmpeg`) espone oggi:

| Endpoint                                       | Portare?          | Perché                                                                                         |
| ---------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `POST /media/normalize`                        | **sì**            | Prompt C                                                                                       |
| `POST /media/remove_silence`                   | **sì**            | Prompt C                                                                                       |
| `POST /media/m4a_to_mp3`                       | sì, generalizzato | diventa `/audio/convert`                                                                       |
| `POST /media/split`                            | sì                | dividere un episodio lungo in parti                                                            |
| `POST /media/concat`                           | sì                | sigla + corpo + coda                                                                           |
| `GET /<base>/job/<id>`                         | **sì**            | il modello a job serve a tutto il dominio audio                                                |
| `POST /voice/generation`                       | da valutare       | sintesi vocale con Piper: utile per un giornale radio, estranea alla gestione dei propri media |
| `POST /voice/mixing`                           | da valutare       | ha senso solo insieme a `voice/generation`                                                     |
| `POST /media/clock/assemble`                   | no                | assembla un'ora di palinsesto radio: dominio diverso                                           |
| `POST /radio/station*`, `POST /radio/playlist` | no                | pilotano AzuraCast, non c'entrano con questo client                                            |

Nel repository nuovo esistono già branch che anticipano parte del lavoro:
`feature/list-all-media`, `feature/content-custom-fonts`, `feature/api-collections`,
`infrastructure/source-download`, `infrastructure/source-upload`,
`infrastructure/media-bff`. Prima di aprire lavoro nuovo conviene guardarli.

---

## 5. Cosa fa il client, oggi, con quello che c'è

**Indirizzi e chiavi non si chiedono più dentro le due sezioni**: stanno in
_Impostazioni → Servizi di elaborazione_, insieme a relay e server Blossom, con
i default presi dall'ambiente (`.env`, vedi `.env.example`) già valorizzati su
ciò che funziona. Le pagine mostrano le funzionalità e nient'altro; se un
servizio non risponde lo dicono con un rimando alle impostazioni, invece di
piazzare un campo di configurazione in mezzo al lavoro.

La chiave del media-manager resta **vuota nei default versionati**: è una
credenziale, e `NUXT_PUBLIC_*` finisce nel bundle servito al browser. Chi
sviluppa la mette nel proprio `.env`; il sito pubblicato parte senza, e chi lo
usa la inserisce dalle impostazioni.

La sezione **Elabora** copre il percorso completo per le immagini, contro il
media-manager: si portano gli ingredienti nel suo archivio (da file locale o da
un indirizzo, tipicamente un file già su Blossom), si compone con `copertina` o
`composita`, e il risultato si scarica oppure torna su Blossom, pronto per
essere pubblicato come evento Nostr.

La sezione **Audio** copre la pre-elaborazione — taglio dei silenzi con soglia
e durata regolabili da cursore, livellamento delle voci, confronto con
l'originale e scaricamento — e parla con il **servizio vecchio**, l'unico che
sappia farlo. Il flusso si ferma allo scaricamento: niente Blossom, niente
eventi. Quando il dominio audio del media-manager esisterà (Prompt C), cambierà
un adattatore in `packages/nostr-core/src/audio/` e le pagine resteranno come
sono.
