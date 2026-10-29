<script setup lang="ts">
import { chiaveEpisodio } from '~/composables/useImportPodcast'

/**
 * Importing a podcast from another host: the page side of `useImportPodcast`.
 *
 * It walks the creator through the move in the order that loses nothing:
 * read, look, decide, publish the card, publish the episodes. Everything the
 * import will not carry is shown before the first signature.
 */

const imp = useImportPodcast()
const identita = useIdentity()

const xmlIncollato = ref('')
const mostraIncolla = ref(false)

async function daFile(ev: Event): Promise<void> {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  await imp.leggiTesto(await file.text(), imp.urlFonte.value || undefined)
}

// The card on this key is looked at as soon as there is something to import.
watch(
  () => imp.aperto.value,
  (aperto) => {
    if (aperto) void imp.controllaScheda()
  },
)

const peso = (byte: number): string =>
  byte >= 1024 ** 3
    ? `${(byte / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(byte / 1024 ** 2))} MB`

const data = (secondi?: number): string =>
  secondi
    ? new Date(secondi * 1000).toLocaleDateString('it-IT', { dateStyle: 'medium' })
    : 'senza data'

const durata = (secondi?: number): string => {
  if (!secondi) return ''
  const h = Math.floor(secondi / 3600)
  const m = Math.floor((secondi % 3600) / 60)
  const s = String(secondi % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** A copy of the set with the value added or removed: a new Set, so Vue sees the change. */
function alternato<T>(insieme: ReadonlySet<T>, valore: T): Set<T> {
  const copia = new Set(insieme)
  if (copia.has(valore)) copia.delete(valore)
  else copia.add(valore)
  return copia
}

const toggleLotto = (k: string): void => {
  imp.lotto.value = alternato(imp.lotto.value, k)
}
const toggleOriginale = (k: string): void => {
  imp.originaliPerEpisodio.value = alternato(imp.originaliPerEpisodio.value, k)
}
const toggleDestinatario = (i: number): void => {
  imp.destinatariEsclusi.value = alternato(imp.destinatariEsclusi.value, i)
}

const tipi = [
  { value: 'episodic', label: 'Episodico: dal più recente' },
  { value: 'serial', label: 'Seriale: dal primo, in ordine' },
]

/** The card is published, or the one on the key already carries this show's identity. */
const schedaPronta = computed(
  () =>
    imp.scheda.pubblicato.value ||
    (!!imp.datiEsistenti.value?.podcastGuid &&
      imp.datiEsistenti.value.podcastGuid === imp.aperto.value?.podcast.podcastGuid),
)

const categoria = computed(() => {
  const c = imp.campi.categoria
  return c ? [c.principale, c.sotto].filter(Boolean).join(' / ') : ''
})

/** Where a tag that will not be carried is used: «nello show e in 2 episodi». */
const doveUsato = (n: { nelCanale: boolean; episodi: number }): string =>
  [
    n.nelCanale ? 'nello show' : '',
    n.episodi === 1 ? 'in un episodio' : n.episodi ? `in ${n.episodi} episodi` : '',
  ]
    .filter(Boolean)
    .join(' e ')

const etichettaStato: Record<string, string> = {
  'in-attesa': 'in attesa',
  'gia-presente': 'già presente',
  'in-corso': 'in corso…',
  pubblicato: 'pubblicato',
  saltato: 'saltato',
  errore: 'errore',
}
</script>

<template>
  <details class="superficie rounded-xl border p-5">
    <summary class="cursor-pointer text-base font-semibold">
      Importa un podcast da un altro host
      <span class="block text-sm font-normal text-[var(--testo-tenue)]">
        Porta qui un podcast pubblicato su Spotify, Anchor o un altro host, conservando episodi,
        identità e ascoltatori.
      </span>
    </summary>

    <div class="mt-5 flex flex-col gap-5">
      <!-- ── 1. The old feed ── -->
      <form class="flex flex-col gap-3" @submit.prevent="imp.leggiUrl(imp.urlFonte.value)">
        <BaseField
          v-slot="{ id, describedBy }"
          label="Indirizzo del feed RSS attuale"
          hint="Su Spotify for Creators lo trovi in Impostazioni → Distribuzione → feed RSS."
        >
          <BaseInput
            :id="id"
            v-model="imp.urlFonte.value"
            :described-by="describedBy"
            placeholder="https://anchor.fm/s/…/podcast/rss"
          />
        </BaseField>
        <div class="flex flex-wrap items-center gap-2">
          <BaseButton
            type="submit"
            variant="primario"
            :loading="imp.inLettura.value"
            :disabled="!imp.urlFonte.value.trim()"
          >
            Leggi il feed
          </BaseButton>
          <BaseButton variant="fantasma" @click="mostraIncolla = !mostraIncolla">
            Incolla o carica il file
          </BaseButton>
        </div>
      </form>

      <div v-if="mostraIncolla" class="flex flex-col gap-3">
        <BaseField v-slot="{ id }" label="Contenuto del feed (XML)">
          <BaseTextarea :id="id" v-model="xmlIncollato" :rows="5" />
        </BaseField>
        <div class="flex flex-wrap items-center gap-3">
          <BaseButton
            :disabled="!xmlIncollato.trim()"
            @click="imp.leggiTesto(xmlIncollato, imp.urlFonte.value || undefined)"
          >
            Leggi il testo incollato
          </BaseButton>
          <label class="text-sm">
            oppure un file
            <input type="file" accept=".xml,.rss,application/rss+xml,text/xml" @change="daFile" />
          </label>
        </div>
      </div>

      <!-- Reading errors here; the import's own, below by its buttons. -->
      <BaseAlert v-if="imp.errore.value && !imp.aperto.value" tono="pericolo">
        {{ imp.errore.value }}
      </BaseAlert>

      <!-- ── 2. Locked ── -->
      <BaseAlert v-if="imp.lettura.value?.bloccato" tono="pericolo">
        <strong>Questo feed è protetto contro l’importazione.</strong>
        Il vecchio host lo ha bloccato con il tag
        <code>podcast:locked</code>
        proprio per impedire che lo show venga copiato altrove senza il permesso del proprietario.
        Sbloccalo dal pannello del vecchio host e rileggilo.
        <template v-if="imp.lettura.value.proprietario">
          Proprietario dichiarato:
          <strong>{{ imp.lettura.value.proprietario }}</strong>
        </template>
      </BaseAlert>

      <template v-if="imp.aperto.value">
        <!-- ── 0. The key, and the card already on it ── -->
        <section class="flex flex-col gap-2">
          <h3 class="font-semibold">La scheda su questa chiave</h3>
          <p v-if="!imp.schedaEsistente.value" class="text-sm text-[var(--testo-tenue)]">
            Nessuna scheda podcast su questa chiave: verrà creata con i dati qui sopra.
          </p>
          <template v-else>
            <BaseAlert v-if="imp.segniDistribuzione.value.length" tono="pericolo">
              La scheda «{{ imp.datiEsistenti.value?.title }}» risulta già distribuita ({{
                imp.segniDistribuzione.value.join('; ')
              }}). Due podcast non stanno su una chiave, e sostituirla trasformerebbe quello show in
              un altro per chi lo segue: importa su una chiave dedicata.
            </BaseAlert>
            <template v-else>
              <p class="text-sm">
                Su questa chiave c’è già la scheda «{{ imp.datiEsistenti.value?.title }}». È già
                pubblicata su qualche piattaforma?
              </p>
              <div class="flex gap-4 text-sm">
                <label class="flex items-center gap-1">
                  <input v-model="imp.rispostaDistribuita.value" type="radio" value="si" />
                  Sì
                </label>
                <label class="flex items-center gap-1">
                  <input v-model="imp.rispostaDistribuita.value" type="radio" value="no" />
                  No, si può sostituire
                </label>
              </div>
              <BaseAlert v-if="imp.rispostaDistribuita.value === 'si'" tono="pericolo">
                Allora non va sostituita: importa su una chiave dedicata.
              </BaseAlert>
            </template>
            <BaseAlert v-if="imp.episodiNativi.value.length" tono="avviso">
              {{
                imp.episodiNativi.value.length === 1
                  ? 'Un episodio già pubblicato su questa chiave entrerà'
                  : `${imp.episodiNativi.value.length} episodi già pubblicati su questa chiave entreranno`
              }}
              nel feed di «{{ imp.campi.titolo }}». NMC non sa cancellare eventi: se non c’entrano,
              importa su una chiave dedicata.
            </BaseAlert>
          </template>
        </section>

        <MediaChiavePodcast
          v-model="imp.sceltaChiave.value"
          :titolo="imp.campi.titolo"
          :immagine="imp.campi.immagine"
          :descrizione="imp.campi.descrizione"
          :blocco-questa="imp.bloccoQuesta.value"
          :prima-del-passaggio="imp.copiaCopertina"
          @creata="imp.chiaveDedicataCreata"
        />

        <!-- ── 3. The preview: the show ── -->
        <section class="flex flex-col gap-3">
          <h3 class="font-semibold">La scheda dello show</h3>
          <p class="text-sm text-[var(--testo-tenue)]">
            Identità ereditata:
            <code>{{ imp.aperto.value.podcast.podcastGuid ?? 'nessuna' }}</code>
            <template v-if="imp.aperto.value.podcast.podcastGuidCalcolato">
              (calcolata dall’indirizzo del vecchio feed, come la conosce Podcast Index)
            </template>
          </p>

          <BaseField v-slot="{ id }" label="Titolo" required>
            <BaseInput :id="id" v-model="imp.campi.titolo" />
          </BaseField>
          <p v-if="imp.datiEsistenti.value" class="-mt-2 text-xs text-[var(--testo-tenue)]">
            Nella tua scheda attuale: «{{ imp.datiEsistenti.value.title }}»
            <button
              type="button"
              class="underline"
              @click="imp.campi.titolo = imp.datiEsistenti.value!.title"
            >
              usa questo
            </button>
          </p>

          <BaseField
            v-slot="{ id }"
            label="Descrizione"
            required
            hint="Già trasformata in testo semplice: YouTube rifiuta l’HTML."
          >
            <BaseTextarea :id="id" v-model="imp.campi.descrizione" :rows="4" />
          </BaseField>

          <BaseField v-slot="{ id }" label="Copertina (URL)" required>
            <BaseInput :id="id" v-model="imp.campi.immagine" />
          </BaseField>

          <div class="grid gap-3 sm:grid-cols-2">
            <BaseField v-slot="{ id }" label="Autore nel feed">
              <BaseInput :id="id" v-model="imp.campi.autore" />
            </BaseField>
            <BaseField v-slot="{ id }" label="Tipo">
              <BaseSelect :id="id" v-model="imp.campi.tipo" :options="tipi" />
            </BaseField>
            <BaseField v-slot="{ id }" label="Lingua (ISO 639-1)">
              <BaseInput :id="id" v-model="imp.campi.lingua" />
            </BaseField>
            <BaseField
              v-slot="{ id }"
              label="Email del proprietario"
              hint="Spotify, Amazon e YouTube la usano per verificare che il podcast sia tuo."
            >
              <BaseInput :id="id" v-model="imp.campi.email" type="email" />
            </BaseField>
          </div>
          <p v-if="imp.campi.categoria" class="text-sm">
            Categoria:
            <strong>{{ categoria }}</strong>
          </p>
        </section>

        <!-- ── warnings and what is not carried ── -->
        <BaseAlert
          v-for="a in imp.aperto.value.avvisi"
          :key="a.codice + (a.episodio ?? '')"
          tono="avviso"
        >
          {{ a.testo }}
        </BaseAlert>
        <BaseAlert v-if="imp.aperto.value.nonRiportati.length" tono="avviso">
          Questi elementi del vecchio feed
          <strong>non verranno riportati:</strong>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="n in imp.aperto.value.nonRiportati" :key="n.tag">
              <code>{{ n.tag }}</code>
              {{ doveUsato(n) }}
            </li>
          </ul>
        </BaseAlert>

        <!-- ── the split ── -->
        <section v-if="imp.aperto.value.podcast.valore" class="flex flex-col gap-2">
          <h3 class="font-semibold">Ripartizione dei pagamenti Lightning (boost)</h3>
          <p class="text-sm text-[var(--testo-tenue)]">
            Così Fountain e gli altri lettori sanno a chi mandare i sat. Togli chi non deve più
            riceverli: spesso è il vecchio host, marcato come «compenso».
          </p>
          <ul class="flex flex-col gap-1">
            <li
              v-for="(d, i) in imp.aperto.value.podcast.valore.destinatari"
              :key="d.indirizzo"
              class="flex flex-wrap items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                :checked="!imp.destinatariEsclusi.value.has(i)"
                :aria-label="`Includi ${d.nome}`"
                @change="toggleDestinatario(i)"
              />
              <strong>{{ d.nome || '(senza nome)' }}</strong>
              <code class="truncate">{{ d.indirizzo }}</code>
              <span>quota {{ d.quota }}</span>
              <BaseBadge v-if="d.fee">compenso</BaseBadge>
            </li>
          </ul>
          <BaseAlert v-if="!imp.valoreScheda.value" tono="avviso">
            Senza destinatari lo show non riceverà più boost.
          </BaseAlert>
        </section>

        <!-- ── where it already is ── -->
        <section class="flex flex-col gap-2">
          <h3 class="font-semibold">Dove è già distribuito</h3>
          <p class="text-sm text-[var(--testo-tenue)]">
            Incolla il link dello show sulle piattaforme dove c’è già: lì seguirà il redirect dal
            vecchio host, e NMC ti ricorderà di non risottometterlo.
          </p>
          <div class="grid gap-2 sm:grid-cols-2">
            <BaseField
              v-for="p in [
                { id: 'apple', nome: 'Apple Podcasts' },
                { id: 'spotify', nome: 'Spotify' },
                { id: 'amazon', nome: 'Amazon Music' },
                { id: 'youtube', nome: 'YouTube' },
              ]"
              :key="p.id"
              v-slot="{ id }"
              :label="p.nome"
            >
              <BaseInput
                :id="id"
                v-model="imp.giaDistribuito.value[p.id]"
                placeholder="https://…"
              />
            </BaseField>
          </div>
        </section>

        <!-- ── the files and the batch ── -->
        <section class="flex flex-col gap-3">
          <h3 class="font-semibold">Episodi e file</h3>
          <fieldset class="flex flex-col gap-1 text-sm">
            <legend class="sr-only">Cosa fare dei file</legend>
            <label class="flex items-start gap-2">
              <input v-model="imp.modoFile.value" type="radio" value="copia" />
              <span>
                <strong>Copia su Blossom (consigliato):</strong>
                il podcast non dipende più dal vecchio host, e puoi anche chiudere l’account senza
                perdere gli audio.
              </span>
            </label>
            <label class="flex items-start gap-2">
              <input v-model="imp.modoFile.value" type="radio" value="originale" />
              <span>
                <strong>Tieni gli URL originali:</strong>
                niente da copiare, e il vecchio host continua a contare i download. Ma se chiudi
                l’account, quegli episodi restano muti.
              </span>
            </label>
          </fieldset>

          <p class="text-sm">
            Da copiare in questo lotto:
            <strong>{{ peso(imp.pesoLotto.value) }}</strong>
            (limite di sicurezza {{ peso(imp.limite.value) }}, modificabile in Impostazioni).
            <template v-if="imp.aperto.value.episodiSenzaPeso === 1">
              Un episodio non dichiara il peso e non è contato.
            </template>
            <template v-else-if="imp.aperto.value.episodiSenzaPeso">
              {{ imp.aperto.value.episodiSenzaPeso }} episodi non dichiarano il peso e non sono
              contati.
            </template>
          </p>
          <BaseAlert v-if="imp.superaLimite.value" tono="avviso">
            Il lotto supera il limite di sicurezza. Puoi copiare adesso i più recenti che ci stanno
            e il resto in un secondo momento: rilanciando l’import, gli episodi già pubblicati
            vengono saltati.
            <BaseButton size="sm" class="mt-2" @click="imp.proponiLottoNelLimite()">
              Seleziona i più recenti nel limite
            </BaseButton>
          </BaseAlert>

          <ul class="flex flex-col gap-1.5">
            <li
              v-for="e in imp.aperto.value.episodi"
              :key="chiaveEpisodio(e)"
              class="superficie flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                :disabled="!e.audio"
                :checked="imp.lotto.value.has(chiaveEpisodio(e))"
                :aria-label="`Importa ${e.titolo}`"
                @change="toggleLotto(chiaveEpisodio(e))"
              />
              <span class="min-w-0 flex-1">
                <strong>{{ e.titolo }}</strong>
                <span class="block text-xs text-[var(--testo-tenue)]">
                  {{ data(e.publishedAt) }}
                  <template v-if="e.durata">· {{ durata(e.durata) }}</template>
                  <template v-if="e.stagione">· stagione {{ e.stagione }}</template>
                  <template v-if="e.numero">· episodio {{ e.numero }}</template>
                  <template v-if="e.tipoEpisodio && e.tipoEpisodio !== 'full'">
                    · {{ e.tipoEpisodio }}
                  </template>
                  <template v-if="e.audio?.peso">· {{ peso(e.audio.peso) }}</template>
                </span>
              </span>
              <BaseBadge v-if="imp.giaPresente(e)">già presente</BaseBadge>
              <BaseBadge v-if="!e.guid">senza GUID</BaseBadge>
              <BaseBadge v-if="!e.audio">senza audio</BaseBadge>
              <label
                v-if="imp.modoFile.value === 'copia' && e.audio"
                class="flex items-center gap-1 text-xs"
              >
                <input
                  type="checkbox"
                  :checked="imp.originaliPerEpisodio.value.has(chiaveEpisodio(e))"
                  @change="toggleOriginale(chiaveEpisodio(e))"
                />
                tieni l’URL originale
              </label>
              <span
                v-if="imp.avanzamento.value[chiaveEpisodio(e)]"
                class="w-full text-xs"
                :class="
                  imp.avanzamento.value[chiaveEpisodio(e)]!.stato === 'errore' &&
                  'text-[var(--pericolo)]'
                "
              >
                {{ etichettaStato[imp.avanzamento.value[chiaveEpisodio(e)]!.stato] }}
                <template v-for="n in imp.avanzamento.value[chiaveEpisodio(e)]!.note" :key="n">
                  · {{ n }}
                </template>
              </span>
            </li>
          </ul>
        </section>

        <!-- ── 5. Publishing ── -->
        <section class="flex flex-col gap-3">
          <BaseAlert v-if="!identita.puoFirmare" tono="avviso">
            {{ identita.motivoNonFirmabile ?? 'Serve un’identità che possa firmare.' }}
          </BaseAlert>
          <p class="text-sm text-[var(--testo-tenue)]">
            Con un’estensione la firma ti verrà chiesta più volte: una per la scheda, una per ogni
            episodio, e una per ogni file copiato su Blossom.
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <BaseButton
              variant="primario"
              :loading="imp.inScheda.value"
              :disabled="
                !identita.puoFirmare || !imp.chiavePronta.value || imp.scheda.pubblicato.value
              "
              @click="imp.pubblicaScheda()"
            >
              1. Pubblica la scheda
            </BaseButton>
            <BaseButton
              variant="primario"
              :loading="imp.inImport.value"
              :disabled="
                !identita.puoFirmare ||
                !schedaPronta ||
                imp.lotto.value.size === 0 ||
                imp.superaLimite.value
              "
              @click="imp.importaEpisodi()"
            >
              2. Importa {{ imp.lotto.value.size }} episodi
            </BaseButton>
          </div>
          <BaseAlert v-for="n in imp.noteScheda.value" :key="n" tono="avviso">{{ n }}</BaseAlert>
          <BaseAlert v-if="imp.scheda.errore.value" tono="pericolo">
            {{ imp.scheda.errore.value }}
          </BaseAlert>
          <PublishResult
            v-if="imp.scheda.invio.esito.value"
            :esito="imp.scheda.invio.esito.value"
          />
          <BaseAlert v-if="imp.errore.value && imp.aperto.value" tono="pericolo">
            {{ imp.errore.value }}
          </BaseAlert>
          <p v-if="imp.fase.value" class="text-sm" aria-live="polite">{{ imp.fase.value }}</p>
        </section>
      </template>
    </div>
  </details>
</template>
