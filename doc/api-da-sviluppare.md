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

### Aggiornamento del 7 settembre 2026 — il servizio audio è già deployato

Il dominio audio non esiste in `microservice-media-manager`, ma il servizio
`ffmpeg` del repository precedente **è vivo** su
`http://api-v0-bitcoinradio.duckdns.org`: un `GET` sulle rotte risponde `405`,
cioè esistono e vogliono `POST`. E, a differenza del media-manager, **espone
correttamente il CORS**: il preflight risponde `200` con
`Access-Control-Allow-Origin`. È chiamabile da un browser oggi, purché la
pagina sia su `http` (manca l'HTTPS anche lì).

Il client lo usa già: vedi la sezione «Audio». Quello che ha dovuto assorbire,
e che il Prompt C deve correggere alla radice:

- **Le cartelle impongono l'ordine.** Un upload `mp3` finisce in
  `uploads/mp3_media`; `remove_silence` legge **solo da lì** e scrive in
  `uploads/clean`; `normalize` scrive in `uploads/normalized`. Quindi
  normalizzare per primo rende il file irraggiungibile al taglio dei silenzi —
  è quasi certamente il motivo per cui in `create_yt_media.py` quel passaggio è
  commentato. L'ordine giusto è l'inverso, ed è anche quello giusto per la
  qualità.
- **Il taglio dei silenzi vale solo per gli mp3.** Un m4a va convertito prima
  (`/media/m4a_to_mp3`); per un wav non esiste convertitore, e l'operazione è
  semplicemente indisponibile.
- **`remove_silence` non espone `stop_silence`**: le pause vengono azzerate, non
  accorciate, e gli stacchi risultano bruschi. È il parametro che manca di più.
- Cose che invece funzionano bene e vanno conservate nel port: `normalize`
  accetta un **URL** come `source_file` e scarica da sé; il job restituisce
  `output_file` e `download_link`, quindi il client non deve indovinare il nome
  del risultato; `/voice/download` cerca ricorsivamente in tutte le cartelle,
  ed è ciò che tiene insieme la catena.

### Prompt C-bis — Togliere alla radice i vincoli che il client oggi aggira

Da svolgere **insieme** al Prompt C: sono le modifiche che rendono inutili gli
espedienti che il client ha dovuto adottare. Ognuna nasce da una riga di codice
letta, non da un'impressione.

```
Lavori sul dominio audio (Prompt C). Questo intervento riguarda il *modello*
del servizio, non le singole operazioni: sono i vincoli che oggi un client deve
aggirare, e che nel port non vanno riportati.

1. RIFERIMENTI AI FILE, non cartelle per operazione. È la causa di tutto il
   resto. Oggi `remove_silence` legge da CONVERTED_FOLDER (uploads/mp3_media) e
   scrive in CLEANED_FOLDER; `normalize` scrive in NORMALIZED_FOLDER. Ne
   discendono due limiti che non hanno alcuna ragione d'essere:
   - **l'ordine delle operazioni è obbligato**: normalizzando prima, il file
     finisce in una cartella che il taglio dei silenzi non guarda, e la catena
     si spezza (è quasi certamente perché in create_yt_media.py quel passaggio
     è commentato);
   - **il taglio dei silenzi vale solo per gli mp3**, perché legge dalla
     cartella degli mp3; un m4a va convertito prima, un wav non si può proprio.
   Nel dominio nuovo ogni operazione deve accettare lo stesso tipo di
   riferimento e risolverlo allo stesso modo — come già fa `normalize`, che
   accetta un URL. Con questo, ordine libero e formati indifferenti.

2. NON DISTRUGGERE L'INGRESSO. `remove_silence` fa `os.remove(input_file_path)`
   e `m4a_to_mp3` pure. Conseguenza pratica, oggi visibile nel client: la
   pagina espone un cursore per la soglia del silenzio, e **riprovare con una
   soglia diversa è l'azione più normale del mondo** — ma il file di partenza
   non c'è più e va ricaricato. Le operazioni devono produrre un nuovo oggetto
   e lasciare intatto quello di partenza; la pulizia è una politica di
   ritenzione, non un effetto collaterale.

3. `stop_silence`. Oggi `silenceremove` è invocato con
   `stop_periods=-1:stop_duration=…:stop_threshold=…` e basta: le pause
   vengono **azzerate**, non accorciate, e gli stacchi risultano bruschi.
   Esporre `stop_silence` (quanto silenzio lasciare, es. 0.3s) come parametro
   dell'API, con un default che lasci una pausa udibile.

4. NON RICOMPRIMERE A OGNI PASSAGGIO. La catena di oggi su un mp3 fa tre
   generazioni lossy: l'originale, la ricodifica di `remove_silence` (che
   riusa codec e bitrate della sorgente) e quella di `normalize`. Le fasi
   intermedie devono lavorare su un formato senza perdita (wav o flac) e la
   compressione deve avvenire **solo all'ultimo passaggio**, quello che produce
   il file consegnato.

5. `remove_silence` SIA UN JOB. Oggi è sincrona mentre `normalize` e
   `m4a_to_mp3` sono asincrone. Su un file lungo la richiesta resta appesa
   finché non scade qualcosa — un proxy, il browser — e il client non ha modo
   di distinguere «sta lavorando» da «è morto». Stesso modello a job per tutte
   le operazioni lunghe.

6. I JOB SOPRAVVIVANO AL RIAVVIO. `jobs` è un dizionario in memoria di
   processo: un riavvio perde tutti i lavori in corso, e più di un worker non
   può funzionare. Serve uno stato condiviso e persistente.

7. UN ENDPOINT DI MISURA — è quello che aiuta di più l'interfaccia.
   `POST /audio/analyze` che restituisca, senza modificare nulla: loudness
   integrata (LUFS), true peak, loudness range, **livello del rumore di
   fondo**, e la distribuzione delle durate dei silenzi sopra alcune soglie.
   Oggi il client propone -40dB e 1s come default ragionevoli, ma sono
   ragionevoli *in generale*: con la misura potrebbe proporre la soglia giusta
   **per quella registrazione**, che è la differenza fra un cursore che si
   muove alla cieca e uno che parte dal punto giusto.

8. `verify=False` nella `requests.get` di `normalize` disattiva la verifica del
   certificato TLS. Se serve per un certificato interno, si aggiunga quella CA;
   non si spenga il controllo.
```

### Prompt C — Il dominio audio (non esiste, e serve)

```
Repository: microservice-media-manager, contract-first, branch develop.

Obiettivo: un nuovo dominio `audio` con l'elaborazione che oggi vive solo nel
repository precedente (microservices-media, branch dev, servizio `ffmpeg`).

Operazioni minime:
- POST /v0/audio/normalize  — livella il parlato
- POST /v0/audio/silence    — accorcia i silenzi
- POST /v0/audio/convert    — cambia contenitore/codec (sostituisce m4a_to_mp3)
- GET  /v0/audio/job/{id}   — stato di una lavorazione asincrona

L'input è un media già caricato (id o nome, come fa `content`), non un upload
diretto: così la stessa sorgente si riusa fra le operazioni. L'output è un
nuovo media, e la risposta ne porta id e URL, come fa GET /v0/content/image.
Le lavorazioni sono lunghe: modello a job con polling, come nel servizio
vecchio (`POST` → 202 + job_id, `GET .../job/{id}` → stato).

IMPORTANTE — il codice esistente NON produce l'effetto desiderato, e la causa è
stata misurata, non ipotizzata. Catena attuale in
`ffmpeg/processors/ffmpeg_processor.py`:

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

Da fare quindi:
1. `maxgain` deve essere un parametro dell'API, con default alto (50–100) e non
   il 10 di ffmpeg; documentare che è il tetto di correzione in dB (20·log10 m).
2. Ordine della pipeline: **prima i silenzi, poi la normalizzazione.**
   Misurato: normalizzando prima, l'amplificazione alza il rumore di fondo sopra
   la soglia di silenzio e la rimozione non lo riconosce più — sullo stesso
   file, 56.2 s contro 28.1 s di durata finale. Lo script `create_yt_media.py`
   fa esattamente l'ordine sbagliato.
3. `silenceremove` oggi è usato come
   `stop_periods=-1:stop_duration=…:stop_threshold=…`, che **azzera** le pause e
   produce stacchi innaturali. Esporre anche `stop_silence` (quanto silenzio
   lasciare, es. 0.3 s) e documentare che `stop_threshold` vuole un'unità
   (`-40dB`), altrimenti è ampiezza lineare.
4. Valutare `loudnorm` in due passate (misura, poi applica con `measured_*` e
   `linear=true`): in una passata sola lavora in modo dinamico e aggiunge una
   seconda compressione sopra a quella di dynaudnorm. Non l'ho misurato:
   verificalo prima di deciderlo.
5. Limite noto da dichiarare nell'API, non da risolvere: quando due voci si
   sovrappongono nello stesso canale nessuna di queste tecniche le separa. Se
   esistono tracce separate per parlante, normalizzarle singolarmente prima del
   missaggio dà un risultato molto migliore — valuta un endpoint che accetti più
   tracce.

Test: file sintetico con due livelli molto diversi, verifica che lo scarto fra i
turni scenda sotto 1 LU e che il file finisca a -16 LUFS ±0.5.
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

La sezione **Elabora** copre il percorso completo per le immagini:

1. si configura indirizzo e chiave del servizio (restano nel browser);
2. si portano gli ingredienti nell'archivio del servizio, da file locale o da un
   indirizzo — tipicamente un file già su Blossom;
3. si compone con `copertina` o `composita`;
4. il risultato si scarica oppure torna su Blossom, pronto per essere pubblicato
   come evento Nostr.

L'audio resta dichiarato come non disponibile finché il Prompt C non è svolto:
il client non finge una funzione che il servizio non ha.
