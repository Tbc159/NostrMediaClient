import {
  accettaUpload,
  mirrorBlob,
  uploadBlob,
  type BlobDescriptor,
  type EsitoPreUpload,
} from '@nmc/nostr-core'

export interface FileCaricato {
  descrittore: BlobDescriptor
  /** The servers that have it: the primary first, then the mirrors that succeeded. */
  copie: string[]
}

/**
 * Putting one file on Blossom: the primary server, then the mirrors.
 *
 * The same steps the Upload tab has always taken, pulled out so the podcast
 * import can take them too, one file at a time. The mirrors do not block: when
 * one fails the file stays on the primary, which is less redundancy and not a
 * failed upload.
 */
export function useBlossom() {
  const identita = useIdentity()
  const config = useClientConfig()

  const server = computed(() => config.value.blossomServers)
  const primario = computed(() => server.value[0] ?? null)

  /** Why an upload cannot start, or `null` when it can. */
  const motivoNonCaricabile = computed<string | null>(() => {
    if (!identita.puoFirmare) {
      return (
        identita.motivoNonFirmabile ??
        'Serve un’identità che possa firmare: Blossom autorizza il caricamento con un evento firmato.'
      )
    }
    if (!primario.value) {
      return 'Nessun server Blossom configurato. Impostane uno dalle impostazioni.'
    }
    return null
  })

  /** Asks the primary, before downloading anything, whether it would take a file like this. */
  function chiedi(peso: number, mime: string): Promise<EsitoPreUpload> {
    if (!primario.value) {
      return Promise.resolve({
        esito: 'sconosciuto',
        stato: null,
        motivo: 'Nessun server Blossom configurato.',
      })
    }
    return accettaUpload(primario.value, { peso, mime })
  }

  /**
   * Uploads a file to the primary and mirrors it to the others.
   *
   * @param avanzamento called with the server being contacted, for feedback.
   */
  async function carica(
    blob: Blob,
    opzioni: { mime: string; nome: string },
    avanzamento?: (fase: 'invio' | 'replica', server: string) => void,
  ): Promise<FileCaricato> {
    const motivo = motivoNonCaricabile.value
    if (motivo) throw new Error(motivo)
    const base = primario.value as string
    const firma = (template: Parameters<typeof identita.firma>[0]) => identita.firma(template)

    avanzamento?.('invio', base)
    // The name is what chooses the extension in the URL: an «.mp3» stays an
    // «.mp3», instead of the «.mpga» the server would answer with.
    const descrittore = await uploadBlob(base, blob, {
      firma,
      pubkey: identita.pubkey ?? '',
      mime: opzioni.mime,
      nome: opzioni.nome,
    })

    const copie = [base]
    for (const altro of server.value.slice(1)) {
      avanzamento?.('replica', altro)
      try {
        await mirrorBlob(altro, descrittore.url, descrittore.sha256, {
          firma,
          pubkey: identita.pubkey ?? '',
          mime: opzioni.mime,
          nome: opzioni.nome,
        })
        copie.push(altro)
      } catch {
        // The primary has the file: a missed mirror is less redundancy, not a
        // failed upload.
      }
    }
    return { descrittore, copie }
  }

  return { server, primario, motivoNonCaricabile, chiedi, carica }
}
