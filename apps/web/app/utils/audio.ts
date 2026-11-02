/** The length of a local audio file, read by the browser; `undefined` if it cannot. */
export function durataFileAudio(file: File): Promise<number | undefined> {
  return new Promise((risolvi) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const fine = (valore?: number) => {
      URL.revokeObjectURL(url)
      risolvi(valore && Number.isFinite(valore) ? valore : undefined)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => fine(audio.duration)
    audio.onerror = () => fine()
    audio.src = url
  })
}

/** Seconds as «m:ss». */
export function formatoDurata(secondi: number): string {
  const m = Math.floor(secondi / 60)
  const s = Math.round(secondi % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Whether a file is plausibly the episode it replaces: about the same length.
 * Asks when it is more than 10% off; `true` when either length is unknown.
 */
export async function stessoEpisodio(
  file: File,
  attesa: number | undefined,
): Promise<{
  ok: boolean
  durata?: number
}> {
  const durata = await durataFileAudio(file)
  if (!durata || !attesa || Math.abs(durata - attesa) / attesa <= 0.1) {
    return { ok: true, ...(durata ? { durata } : {}) }
  }
  const ok = window.confirm(
    `Il file dura ${formatoDurata(durata)}, l’episodio ${formatoDurata(attesa)}. È davvero lo stesso episodio?`,
  )
  return { ok, durata }
}
