/**
 * MIME ↔ estensione: l'unica tabella del progetto.
 *
 * Serve a una cosa precisa: **scegliere l'estensione nell'URL di un blob
 * Blossom**. Il server decide l'estensione con cui risponde a `PUT /upload`,
 * e la decide come gli pare — yakihonne mappa `audio/mpeg` su `.mpga`, che
 * è corretto per IANA e sconosciuto a molti lettori di podcast. BUD-01 però
 * obbliga il server ad accettare *qualunque* estensione in `GET /<sha256>`,
 * rispondendo con il MIME vero: quindi l'estensione la può scegliere il
 * client, e sceglie quella che il mondo si aspetta.
 *
 * Preferenza: l'estensione del file originale, se è coerente con il MIME;
 * altrimenti la prima della tabella. Un `.mp3` caricato resta `.mp3`, un
 * `audio/mpeg` senza nome diventa `.mp3` e non `.mpga`.
 */

/** Per ogni MIME, le estensioni accettate; la prima è quella da usare. */
const TABELLA: Readonly<Record<string, readonly string[]>> = {
  'audio/mpeg': ['mp3', 'mpga', 'mp2'],
  'audio/mp3': ['mp3'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/x-m4a': ['m4a'],
  'audio/m4a': ['m4a'],
  'audio/aac': ['aac'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/wave': ['wav'],
  'audio/ogg': ['ogg', 'oga'],
  'audio/opus': ['opus'],
  'audio/flac': ['flac'],
  'audio/x-flac': ['flac'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/jpg': ['jpg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'image/avif': ['avif'],
  'image/svg+xml': ['svg'],
  'video/mp4': ['mp4', 'm4v'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  'application/pdf': ['pdf'],
}

const pulisciMime = (mime: string): string => mime.toLowerCase().split(';')[0]?.trim() ?? ''

/** L'estensione (senza punto) di un nome file, in minuscolo; `null` se non ne ha. */
export function estensioneDelNome(nome: string | undefined): string | null {
  if (!nome) return null
  const base = nome.split(/[?#]/)[0] ?? ''
  const i = base.lastIndexOf('.')
  if (i <= 0 || i === base.length - 1) return null
  const ext = base.slice(i + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null
}

/**
 * L'estensione giusta per un MIME, tenendo conto del nome originale.
 *
 * Restituisce `null` se il MIME non è in tabella e il nome non aiuta: in
 * quel caso l'URL resta com'è — meglio l'estensione del server che una
 * inventata.
 */
export function estensionePer(mime: string, nomeOriginale?: string): string | null {
  const ammesse = TABELLA[pulisciMime(mime)]
  const delNome = estensioneDelNome(nomeOriginale)
  if (ammesse) {
    // Il nome originale vince solo se è coerente col MIME: un «foto.mp3»
    // che è un PNG non deve diventare .mp3.
    return delNome && ammesse.includes(delNome) ? delNome : (ammesse[0] ?? null)
  }
  return delNome
}

/** I MIME audio che le piattaforme di podcast accettano negli enclosure. */
export const MIME_AUDIO_PODCAST: readonly string[] = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
]

/** Vero se un audio con questo MIME va bene per Apple, Spotify, Amazon e YouTube. */
export function audioAdattoAlPodcast(mime: string): boolean {
  return MIME_AUDIO_PODCAST.includes(pulisciMime(mime))
}

/**
 * Riscrive l'estensione di un URL Blossom (`…/<sha256>[.ext]`).
 *
 * Tocca solo l'ultimo segmento e solo se è un hash SHA-256: qualunque altro
 * URL torna intatto. Senza un'estensione da mettere, resta quello del server.
 */
export function urlConEstensione(url: string, mime: string, nomeOriginale?: string): string {
  const ext = estensionePer(mime, nomeOriginale)
  if (!ext) return url
  const m = /^(.*\/)([0-9a-f]{64})(?:\.[a-z0-9]{1,8})?$/i.exec(url)
  if (!m) return url
  return `${m[1]}${m[2]!.toLowerCase()}.${ext}`
}
