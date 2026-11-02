<script setup lang="ts">
import {
  cancellaVersioniPrecedenti,
  dataNelFeed,
  fileSuBlossom,
  podcastEpisodeDefinition,
  sostituisciFileEpisodio,
  ultimaVersionePerGuid,
  type NostrEvent,
} from '@nmc/nostr-core'

/**
 * The episodes on this key, and where their files live.
 *
 * An import that could not copy a file leaves the episode playing from the old
 * host, which keeps the podcast tied to an account the creator meant to
 * leave. Here the file can be replaced by hand: upload it to Blossom and
 * publish the episode again with the same GUID and date. The feed service
 * keeps the newest kind 54 per GUID, so for the apps it is the same episode
 * with a new file — no duplicate, no change of date or order.
 */

const identita = useIdentity()
const blossom = useBlossom()
const invio = usePublish()
const propri = useEventiPropri([54], { limite: 500 })

interface Riga {
  evento: NostrEvent
  titolo: string
  data: number
  durata?: number
  audio?: string
  immagine?: string
  /** The hosts that are not Blossom, for the label «still depends on …». */
  altrove: string[]
}

const suBlossom = (url: string): boolean => fileSuBlossom(url, blossom.server.value)

const host = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const righe = computed<Riga[]>(() =>
  ultimaVersionePerGuid(propri.eventi.value)
    .flatMap((evento): Riga[] => {
      try {
        const p = podcastEpisodeDefinition.parse(evento)
        const audio = p.audio[0]?.url
        const file = [audio, p.image].filter((u): u is string => !!u)
        return [
          {
            evento,
            titolo: p.title,
            data: dataNelFeed(evento),
            ...(p.duration ? { durata: p.duration } : {}),
            ...(audio ? { audio } : {}),
            ...(p.image ? { immagine: p.image } : {}),
            altrove: [...new Set(file.filter((u) => !suBlossom(u)).map(host))],
          },
        ]
      } catch {
        return []
      }
    })
    // The ones still on the old host first: they are the work left to do.
    .sort((a, b) => Number(b.altrove.length > 0) - Number(a.altrove.length > 0)),
)

const quando = (secondi: number): string =>
  new Date(secondi * 1000).toLocaleDateString('it-IT', { dateStyle: 'medium' })

const stato = ref<Record<string, { tono: 'info' | 'successo' | 'pericolo'; testo: string }>>({})
const inCorso = ref<string | null>(null)

async function sostituisci(riga: Riga, tipo: 'audio' | 'immagine', evento: Event): Promise<void> {
  const input = evento.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const id = riga.evento.id
  const scrivi = (tono: 'info' | 'successo' | 'pericolo', testo: string) => {
    stato.value = { ...stato.value, [id]: { tono, testo } }
  }
  if (!identita.puoFirmare) {
    scrivi('pericolo', identita.motivoNonFirmabile ?? 'Serve un’identità che possa firmare.')
    return
  }
  if (blossom.motivoNonCaricabile.value) {
    scrivi('pericolo', blossom.motivoNonCaricabile.value)
    return
  }

  const mime = file.type || (tipo === 'audio' ? 'audio/mpeg' : 'image/jpeg')
  let nuovaDurata: number | undefined
  if (tipo === 'audio') {
    // The only check that it is the same episode: about the same length.
    const prova = await stessoEpisodio(file, riga.durata)
    if (!prova.ok) return
    nuovaDurata = prova.durata
  }

  inCorso.value = id
  try {
    const prima = await blossom.chiedi(file.size, mime)
    if (prima.esito === 'rifiutato') throw new Error(prima.motivo)
    scrivi('info', `Carico ${file.name} su Blossom…`)
    const { descrittore } = await blossom.carica(file, { mime, nome: file.name })
    const template = sostituisciFileEpisodio(
      riga.evento,
      tipo === 'audio'
        ? { audio: { url: descrittore.url, mime }, ...(nuovaDurata ? { durata: nuovaDurata } : {}) }
        : { immagine: descrittore.url },
      Math.floor(Date.now() / 1000),
    )
    scrivi('info', `Firmo «${riga.titolo}»…`)
    const firmato = await identita.firma(template)
    scrivi('info', `Pubblico «${riga.titolo}»…`)
    if (!(await invio.pubblica(firmato))) {
      throw new Error(invio.errore.value ?? 'Nessun relay l’ha accettato.')
    }
    propri.anteponi(firmato)
    const fatto = `${tipo === 'audio' ? 'Audio' : 'Immagine'} sostituito: il feed mostra lo stesso episodio con il file nuovo entro qualche minuto.`
    let esito: { tono: 'successo' | 'info'; testo: string } = { tono: 'successo', testo: fatto }

    // The old version, asked to go: without it a Nostr client that reads the
    // episodes would show both. The feed is right either way.
    const cancellazione = cancellaVersioniPrecedenti(
      firmato,
      propri.eventi.value,
      Math.floor(Date.now() / 1000),
    )
    if (cancellazione) {
      try {
        const richiesta = await identita.firma(cancellazione)
        if (!(await invio.pubblica(richiesta))) {
          throw new Error(invio.errore.value ?? 'Nessun relay l’ha accettata.')
        }
      } catch (e) {
        esito = {
          tono: 'info',
          testo: `${fatto} La richiesta di cancellazione della versione vecchia non è partita (${e instanceof Error ? e.message : String(e)}): qualche client Nostr potrebbe mostrarle entrambe.`,
        }
      }
    }
    stato.value = { ...stato.value, [firmato.id]: esito }
  } catch (e) {
    scrivi('pericolo', e instanceof Error ? e.message : String(e))
  } finally {
    inCorso.value = null
  }
}
</script>

<template>
  <BaseCard
    v-if="identita.pubkey"
    title="Episodi pubblicati"
    subtitle="Gli episodi di questa chiave e dove stanno i loro file."
  >
    <p v-if="propri.caricamento.value && !righe.length" class="text-sm">Leggo dai relay…</p>
    <p v-else-if="!righe.length" class="text-sm text-[var(--testo-tenue)]">
      Nessun episodio su questa chiave.
    </p>
    <template v-else>
      <p class="mb-3 text-xs text-[var(--testo-tenue)]">
        «Sostituisci» carica il file su Blossom e ripubblica l’episodio con lo stesso GUID e la
        stessa data: per le app resta lo stesso episodio. YouTube però non aggiorna l’audio di un
        episodio già importato, e alcune app tengono in cache il file vecchio. Per la versione
        precedente parte una richiesta di cancellazione (NIP-09): i relay che la rispettano la
        tolgono, e il feed mostra comunque solo la più recente.
      </p>
      <ul class="flex flex-col gap-2">
        <li
          v-for="r in righe"
          :key="r.evento.id"
          class="superficie flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <div class="flex flex-wrap items-center gap-2">
            <strong class="min-w-0 flex-1">{{ r.titolo }}</strong>
            <BaseBadge v-if="r.altrove.length" tono="avviso">
              dipende ancora da {{ r.altrove.join(', ') }}
            </BaseBadge>
            <BaseBadge v-else tono="successo">su Blossom</BaseBadge>
          </div>
          <span class="text-xs text-[var(--testo-tenue)]">
            {{ quando(r.data) }}
            <template v-if="r.durata">· {{ formatoDurata(r.durata) }}</template>
            <template v-if="r.audio">· audio su {{ host(r.audio) }}</template>
            <template v-if="r.immagine">· immagine su {{ host(r.immagine) }}</template>
          </span>
          <div class="flex flex-wrap gap-2">
            <label
              class="cursor-pointer rounded-md border px-2 py-1 text-xs"
              :class="inCorso && 'pointer-events-none opacity-60'"
            >
              Sostituisci l’audio
              <input
                type="file"
                accept="audio/*"
                class="sr-only"
                :disabled="!!inCorso"
                @change="sostituisci(r, 'audio', $event)"
              />
            </label>
            <label
              class="cursor-pointer rounded-md border px-2 py-1 text-xs"
              :class="inCorso && 'pointer-events-none opacity-60'"
            >
              {{ r.immagine ? 'Sostituisci l’immagine' : 'Aggiungi un’immagine' }}
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                :disabled="!!inCorso"
                @change="sostituisci(r, 'immagine', $event)"
              />
            </label>
          </div>
          <BaseAlert v-if="stato[r.evento.id]" :tono="stato[r.evento.id]!.tono">
            {{ stato[r.evento.id]!.testo }}
          </BaseAlert>
        </li>
      </ul>
    </template>
  </BaseCard>
</template>
