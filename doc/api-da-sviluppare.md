# API del microservizio media-manager — stato e prompt

Documento di lavoro per NostrMediaClient. Nato per raccogliere **cosa mancava**
al servizio
[`microservice-media-manager`](https://github.com/Tbc159/microservice-media-manager)
perché questo client potesse usarlo, e i **prompt** da consegnare a chi lo
sviluppa.

> **Stato al 10 settembre 2026 — i prompt sono stati svolti.** Sul branch
> `feature/content-custom-fonts` del servizio esistono i commit che realizzano
> A (CORS e HTTPS), B (`POST /v0/media/from-url`), C (dominio `audio`
> completo), D (preset `social` e `slide`, enum dei formati, elenco senza
> filtro), E (URL firmati) e il contratto degli asset non ambiguo con errori
> `400` diagnosticabili.
>
> **Il client è già allineato a quel contratto.** La sezione **Audio** è in
> `main` e fa tutto sul dominio `audio`; il servizio precedente non è più
> chiamato da nessuna parte. La sezione **Elabora** (immagini: riferimenti per
> `filename`, `from-url`, anteprime con `signed_url`) resta sul branch
> `feature/elabora-immagini` finché la sua UX non è rivista.
>
> **Manca solo il deploy.** Verificato con `curl` oggi contro
> `http://mediamanager-dev.duckdns.org`: `/v0/audio/health` risponde `404`, il
> preflight `OPTIONS /v0/content/image` risponde `405` senza intestazioni CORS,
> e `https://` non risponde. Finché quel branch non è unito e pubblicato, dal
> browser le due sezioni non funzionano contro l'ambiente di sviluppo: la
> verifica del client è stata fatta contro un finto fedele al contratto.

I prompt restano qui sotto come traccia di cosa è stato chiesto e perché: sono
la spiegazione delle scelte che il contratto porta ora dentro di sé.

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

### `microservices-media` è dismesso

Il servizio `ffmpeg` del repository precedente è ancora vivo su
`http://api-v0-bitcoinradio.duckdns.org`, ma **il client non lo chiama più da
nessuna parte**: l'adattatore che gli parlava è stato tolto, insieme ai tre
espedienti che imponeva — l'ordine obbligato delle operazioni, il taglio dei
silenzi riservato agli mp3, e le pause azzerate invece che accorciate.

Su quel repository non si interviene: niente PR, niente correzioni, nemmeno per
i difetti elencati nel prompt qui sotto. Resta acceso finché il dominio audio
del media-manager non è pubblicato, e serve come termine di paragone — a port
avvenuto, sullo stesso file, il risultato dev'essere almeno pari.

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

## 5. Cosa fa il client, oggi

**Un servizio, configurato in un posto solo.** Indirizzo e chiave stanno in
_Impostazioni → Servizio di elaborazione_, con i default presi dall'ambiente
(`.env`, vedi `.env.example`). La pagina Audio mostra soltanto le
funzionalità; se il dominio audio non risponde lo dice con un rimando alle
impostazioni, dove le pastiglie riportano la salute di `media` e `audio`
separatamente — perché è normale, oggi, che il primo risponda e il secondo no.

La chiave resta **vuota nei default versionati**: è una credenziale, e
`NUXT_PUBLIC_*` finisce nel bundle servito al browser. Chi sviluppa la mette nel
proprio `.env`; il sito pubblicato parte senza, e chi lo usa la inserisce dalle
impostazioni.

**Audio** (in `main`, sotto _Media → Audio_) — un file locale, taglio dei
silenzi con soglia e pausa regolabili da cursore, livellamento, confronto con
l'originale. Alla fine due uscite: scaricare, oppure «Pubblica come podcast»,
che porta il file in _Media → Carica su Blossom_ già nel modo episodio (kind
54), con bozze riprendibili e una proposta esportabile per far firmare
un'altra chiave. Tre cose che il contratto nuovo ha reso possibili e che si
vedono in pagina:

- **i wav non sono più esclusi** dal taglio dei silenzi, e un m4a non viene più
  convertito prima: ogni operazione accetta qualunque riferimento;
- **l'ordine non è più imposto**. Il client continua a fare prima i silenzi e
  poi il livellamento, ma ora è una scelta di qualità dichiarata, non un
  vincolo dell'infrastruttura;
- **la sorgente sopravvive**, quindi rifare con un'altra soglia non richiede di
  ricaricare il file — che è l'azione più naturale davanti a un cursore.

**Dal sito pubblicato** (GitHub Pages, `https`) la pagina funzionerà solo
quando il servizio risponderà in `https` con le intestazioni CORS: finché
l'ambiente resta in `http`, il browser blocca la richiesta come contenuto misto
e la pagina lo dice. In sviluppo, da `http://localhost`, funziona già.

**Elabora** (branch `feature/elabora-immagini`) — ingredienti nell'archivio
del servizio, composizione `copertina` o `composita`, anteprima, scaricamento o
ritorno su Blossom. Da rivedere nella UX prima di portarla in `main`: si
compone alla cieca, gli ingredienti spariscono al ricaricamento, mancano le
miniature.

Non è stata aggiunta nessuna funzionalità: `analyze`, `split`, `concat`, i
preset `social` e `slide` e il catalogo font esistono nel contratto e non hanno
ancora un posto nell'interfaccia.
