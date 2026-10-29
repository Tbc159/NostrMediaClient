<script setup lang="ts">
import {
  PIATTAFORME,
  getKindDefinition,
  verificaPiattaforma,
  type MisureCopertina,
  type PodcastMetadataParsed,
  type SchedaPerPiattaforme,
} from '@nmc/nostr-core'

/**
 * The podcast platforms, one by one: what is missing for them to accept the
 * feed.
 *
 * They nearly all ask for the same things, but not all of them demand these,
 * and each verifies ownership in its own way. Instead of a generic «invalid
 * feed», here every platform has its checklist computed against the real data
 * — this key's 10154 card, the measured cover, the episodes' formats — and the
 * link to submit the feed at. The data are corrected in the profile; this page
 * says only *which*.
 *
 * It reads the card from the relays, not from the feed: that way it tells the
 * truth even when the feed's service has not yet learnt to read the new tags.
 */

const identita = useIdentity()
const esistente = useEventoEsistente()
const episodi = useEventiPropri([54], { limite: 200 })
/** Submitting means handing out the feed's address: only the stable one, checked. */
const stabile = useIndirizzoStabile()

const scheda = ref<PodcastMetadataParsed | null>(null)
const copertina = ref<MisureCopertina | null>(null)
const caricamento = ref(false)
const cercata = ref(false)

async function carica(): Promise<void> {
  if (!identita.pubkey) return
  caricamento.value = true
  cercata.value = false
  scheda.value = null
  copertina.value = null
  try {
    const [trovato] = await Promise.all([
      esistente.perCoordinata(10154),
      episodi.eventi.value.length ? Promise.resolve() : episodi.carica(),
    ])
    const definizione = getKindDefinition(10154)
    if (trovato && definizione) {
      try {
        scheda.value = definizione.parse(trovato) as PodcastMetadataParsed
      } catch {
        scheda.value = null
      }
    }
    if (scheda.value?.image) copertina.value = await misura(scheda.value.image)
  } finally {
    caricamento.value = false
    cercata.value = true
  }
}

/** An image's measurements from its URL: `naturalWidth` does not require CORS. */
function misura(url: string): Promise<MisureCopertina | null> {
  return new Promise((risolvi) => {
    const img = new Image()
    img.onload = () => risolvi({ larghezza: img.naturalWidth, altezza: img.naturalHeight })
    img.onerror = () => risolvi(null)
    img.src = url
  })
}

/** The MIMEs of the published episodes' audio: the first `audio` tag of each kind 54. */
const mimeEpisodi = computed(() =>
  episodi.eventi.value
    .map((e) => e.tags.find((t) => t[0] === 'audio')?.[2])
    .filter((m): m is string => typeof m === 'string' && m !== ''),
)

const perPiattaforme = computed<SchedaPerPiattaforme>(() => ({
  ...(scheda.value?.description ? { description: scheda.value.description } : {}),
  ...(scheda.value?.image ? { image: scheda.value.image } : {}),
  categories: scheda.value?.categories ?? [],
  ...(scheda.value?.language ? { language: scheda.value.language } : {}),
  ...(scheda.value?.email ? { email: scheda.value.email } : {}),
  websites: scheda.value?.websites ?? [],
  mimeEpisodi: mimeEpisodi.value,
}))

const esiti = computed(() =>
  PIATTAFORME.map((p) => ({
    piattaforma: p,
    esito: verificaPiattaforma(p, perPiattaforme.value, copertina.value),
  })),
)

onMounted(() => {
  void carica()
  void stabile.caricaDallaScheda()
})
watch(
  () => identita.pubkey,
  () => {
    void carica()
    void stabile.caricaDallaScheda()
  },
)

/** A short label for a satisfied requirement. */
const NOMI_REQUISITI: Record<string, string> = {
  'copertina-quadrata': 'copertina quadrata 1400–3000',
  categoria: 'categoria',
  lingua: 'lingua',
  email: 'email per la verifica',
  descrizione: 'descrizione',
  'episodio-mp3': 'episodi in mp3/m4a',
}
const nomeRequisito = (r: string): string => NOMI_REQUISITI[r] ?? r
</script>

<template>
  <BaseCard
    title="Piattaforme"
    subtitle="Cosa chiede ciascuna per accettare il feed, calcolato sulla tua scheda e sui tuoi episodi. Si corregge dal profilo."
  >
    <div class="flex flex-col gap-4">
      <BaseAlert v-if="!identita.pubkey" tono="avviso">
        Serve un’identità: le piattaforme si valutano sulla scheda della chiave che pubblica.
      </BaseAlert>

      <template v-else>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <BaseBadge v-if="caricamento">leggo la scheda…</BaseBadge>
          <BaseBadge v-else-if="scheda" tono="successo">scheda del podcast trovata</BaseBadge>
          <BaseBadge v-else-if="cercata" tono="avviso">nessuna scheda del podcast</BaseBadge>
          <BaseBadge v-if="episodi.eventi.value.length">
            {{ episodi.eventi.value.length }}
            {{ episodi.eventi.value.length === 1 ? 'episodio' : 'episodi' }}
          </BaseBadge>
          <BaseButton size="sm" variant="fantasma" :loading="caricamento" @click="carica">
            Aggiorna
          </BaseButton>
        </div>

        <BaseAlert
          v-if="cercata && scheda && !stabile.pronto.value && stabile.stato.value !== 'in-verifica'"
          tono="avviso"
        >
          Prima di sottoporre il feed serve il suo indirizzo stabile, verificato: è quello che le
          piattaforme ricorderanno per sempre.
          <NuxtLink to="/profilo" class="underline">Impostalo dal profilo</NuxtLink>
        </BaseAlert>

        <BaseAlert v-if="cercata && !scheda" tono="avviso">
          Senza la scheda del podcast (kind 10154) nessuna piattaforma ha un canale da mostrare.
          <NuxtLink to="/profilo" class="underline">Compilala dal profilo.</NuxtLink>
        </BaseAlert>

        <ul class="grid gap-3 sm:grid-cols-2">
          <li
            v-for="{ piattaforma, esito } in esiti"
            :key="piattaforma.id"
            class="superficie flex flex-col gap-2 rounded-lg border p-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm">{{ piattaforma.nome }}</strong>
              <BaseBadge :tono="esito.pronta ? 'successo' : 'avviso'">
                {{
                  esito.pronta ? 'pronta' : `${esito.voci.filter((v) => !v.ok).length} da sistemare`
                }}
              </BaseBadge>
            </div>

            <p v-if="piattaforma.nota" class="text-xs text-[var(--testo-tenue)]">
              {{ piattaforma.nota }}
            </p>

            <ul class="flex flex-col gap-1 text-xs">
              <li
                v-for="v in esito.voci"
                :key="v.requisito"
                class="flex items-start gap-1.5"
                :class="v.ok ? 'text-[var(--testo-tenue)]' : ''"
              >
                <span aria-hidden="true">{{ v.ok ? '✓' : '✗' }}</span>
                <span>
                  <template v-if="v.ok">{{ nomeRequisito(v.requisito) }}</template>
                  <template v-else>
                    {{ v.testo }}
                    <NuxtLink v-if="v.requisito !== 'episodio-mp3'" to="/profilo" class="underline">
                      → profilo
                    </NuxtLink>
                    <NuxtLink v-else to="/media/audio" class="underline">→ Audio</NuxtLink>
                  </template>
                </span>
              </li>
            </ul>

            <p class="text-xs text-[var(--testo-tenue)]">
              <strong>Proprietà:</strong>
              {{ piattaforma.verificaProprieta }}
            </p>

            <div class="mt-auto flex flex-wrap gap-2 pt-1">
              <BaseButton
                v-if="stabile.pronto.value"
                size="sm"
                :to="piattaforma.sottoponiSu"
                target="_blank"
              >
                Sottoponi su {{ piattaforma.nome }}
              </BaseButton>
              <BaseButton
                v-if="esito.urlShow"
                size="sm"
                variant="fantasma"
                :to="esito.urlShow"
                target="_blank"
              >
                Apri lo show
              </BaseButton>
              <NuxtLink v-else to="/profilo" class="self-center text-xs underline">
                aggiungi il link dello show fra i siti
              </NuxtLink>
            </div>
          </li>

          <li class="superficie flex flex-col gap-2 rounded-lg border p-3">
            <strong class="text-sm">Lettori RSS</strong>
            <p class="text-xs text-[var(--testo-tenue)]">
              Overcast, Pocket Casts, AntennaPod, Podcast Addict e simili: seguono l’URL del feed
              direttamente, senza directory. Basta l’indirizzo qui sopra, o l’OPML.
            </p>
          </li>
        </ul>
      </template>
    </div>
  </BaseCard>
</template>
