/**
 * MIME ↔ extension: the project's only table.
 *
 * It serves one precise purpose: **choosing the extension in a Blossom blob's
 * URL**. The server decides the extension it answers `PUT /upload` with, and
 * it decides as it pleases — yakihonne maps `audio/mpeg` onto `.mpga`, which
 * is correct for IANA and unknown to many podcast players. BUD-01, however,
 * obliges the server to accept *any* extension in `GET /<sha256>`, answering
 * with the real MIME: so the client gets to choose the extension, and it
 * chooses the one the world expects.
 *
 * Preference: the original file's extension, when it is consistent with the
 * MIME; otherwise the first in the table. An uploaded `.mp3` stays `.mp3`, an
 * `audio/mpeg` with no name becomes `.mp3` and not `.mpga`.
 */

/** For each MIME, the accepted extensions; the first is the one to use. */
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

/** A file name's extension (no dot), lower case; `null` when it has none. */
export function estensioneDelNome(nome: string | undefined): string | null {
  if (!nome) return null
  const base = nome.split(/[?#]/)[0] ?? ''
  const i = base.lastIndexOf('.')
  if (i <= 0 || i === base.length - 1) return null
  const ext = base.slice(i + 1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null
}

/**
 * The right extension for a MIME, taking the original name into account.
 *
 * It returns `null` when the MIME is not in the table and the name does not
 * help: in that case the URL stays as it is — better the server's extension
 * than one we invented.
 */
export function estensionePer(mime: string, nomeOriginale?: string): string | null {
  const ammesse = TABELLA[pulisciMime(mime)]
  const delNome = estensioneDelNome(nomeOriginale)
  if (ammesse) {
    // The original name only wins when it is consistent with the MIME: a
    // «photo.mp3» that is really a PNG must not become .mp3.
    return delNome && ammesse.includes(delNome) ? delNome : (ammesse[0] ?? null)
  }
  return delNome
}

/** The audio MIMEs podcast platforms accept in enclosures. */
export const MIME_AUDIO_PODCAST: readonly string[] = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
]

/** True when audio with this MIME suits Apple, Spotify, Amazon and YouTube. */
export function audioAdattoAlPodcast(mime: string): boolean {
  return MIME_AUDIO_PODCAST.includes(pulisciMime(mime))
}

/**
 * Rewrites the extension of a Blossom URL (`…/<sha256>[.ext]`).
 *
 * It touches only the last segment, and only when that is an SHA-256 hash:
 * any other URL comes back untouched. With no extension to put, the server's
 * own stays.
 */
export function urlConEstensione(url: string, mime: string, nomeOriginale?: string): string {
  const ext = estensionePer(mime, nomeOriginale)
  if (!ext) return url
  const m = /^(.*\/)([0-9a-f]{64})(?:\.[a-z0-9]{1,8})?$/i.exec(url)
  if (!m) return url
  return `${m[1]}${m[2]!.toLowerCase()}.${ext}`
}
