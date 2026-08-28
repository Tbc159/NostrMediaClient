<script setup lang="ts">
import { getKindDefinition, slugFromTitle } from '@nmc/nostr-core'

useHead({ title: 'Scrivi un articolo · NostrMediaClient' })

const identita = useIdentity()
const bozza = useEventDraft()
const bozzeLocali = useBozzeLocali()
const bozzeRemote = useBozzeRemote()
const esistente = useEventoEsistente()
const rotta = useRoute()

const titolo = ref('')
const sommario = ref('')
const immagine = ref('')
const hashtag = ref('')
const contenuto = ref('')
const identificatore = ref('')
/** Data della prima pubblicazione, se si sta modificando un articolo esistente. */
const primaPubblicazione = ref<number | null>(null)
/** Vero quando l'identificatore e' stato scritto a mano e non va piu' seguito il titolo. */
const identificatoreManuale = ref(false)

const anteprima = ref(false)

/*
 * L'identificatore segue il titolo finche' l'utente non lo tocca. Cambiarlo
 * dopo la prima pubblicazione **non** modifica l'articolo: ne crea uno nuovo,
 * perche' su un evento addressable e' il tag `d` a dire quale versione si sta
 * sostituendo.
 */
watch(titolo, (nuovo) => {
  if (!identificatoreManuale.value) identificatore.value = slugFromTitle(nuovo)
})

const html = computed(() => renderMarkdown(contenuto.value))
const statistiche = computed(() => statisticheTesto(contenuto.value))

const listaHashtag = computed(() =>
  hashtag.value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
)

const puoComporre = computed(
  () => titolo.value.trim() !== '' && contenuto.value.trim() !== '' && identificatore.value !== '',
)

const modifica = computed(() => primaPubblicazione.value !== null)

function componi(): void {
  const definizione = getKindDefinition(30023)
  if (!definizione) {
    bozza.errore.value = 'Kind 30023 non registrato.'
    return
  }

  bozza.costruisci(definizione, {
    content: contenuto.value,
    identifier: identificatore.value,
    title: titolo.value.trim(),
    ...(sommario.value.trim() ? { summary: sommario.value.trim() } : {}),
    ...(immagine.value.trim() ? { image: immagine.value.trim() } : {}),
    ...(listaHashtag.value.length ? { hashtags: listaHashtag.value } : {}),
    ...(primaPubblicazione.value !== null ? { publishedAt: primaPubblicazione.value } : {}),
  })
}

const salvato = ref(false)
function salvaBozza(): void {
  if (!identificatore.value) {
    bozza.errore.value = 'Serve almeno un titolo, da cui ricavare l’identificatore.'
    return
  }
  bozzeLocali.salva({
    identifier: identificatore.value,
    title: titolo.value,
    summary: sommario.value,
    image: immagine.value,
    hashtag: hashtag.value,
    content: contenuto.value,
    ...(primaPubblicazione.value !== null ? { publishedAt: primaPubblicazione.value } : {}),
  })
  salvato.value = true
  setTimeout(() => (salvato.value = false), 2500)
}

/**
 * Salva la bozza cifrata sul relay privato (NIP-37).
 *
 * A differenza della bozza locale, questa segue su un altro dispositivo. Il
 * contenuto viene cifrato verso se stessi, quindi sul relay resta illeggibile:
 * e' la differenza sostanziale con il vecchio kind 30024, che ci finiva in
 * chiaro.
 */
const salvataggioRemoto = ref(false)
async function salvaBozzaRemota(): Promise<void> {
  if (!identificatore.value) {
    bozza.errore.value = 'Serve almeno un titolo, da cui ricavare l’identificatore.'
    return
  }
  salvataggioRemoto.value = true
  try {
    const definizione = getKindDefinition(30023)
    if (!definizione) return
    // Si costruisce il template dell'articolo ma non lo si firma: quello che
    // si sta salvando e' lavoro in corso, non un evento definitivo.
    const template = definizione.build(
      {
        content: contenuto.value,
        identifier: identificatore.value,
        title: titolo.value.trim(),
        ...(sommario.value.trim() ? { summary: sommario.value.trim() } : {}),
        ...(immagine.value.trim() ? { image: immagine.value.trim() } : {}),
        ...(listaHashtag.value.length ? { hashtags: listaHashtag.value } : {}),
        ...(primaPubblicazione.value !== null ? { publishedAt: primaPubblicazione.value } : {}),
      },
      { pubkey: identita.pubkey ?? '', now: Math.floor(Date.now() / 1000) },
    )
    await bozzeRemote.salva(identificatore.value, template)
  } catch (e) {
    bozza.errore.value = e instanceof Error ? e.message : String(e)
  } finally {
    salvataggioRemoto.value = false
  }
}

/** Riapre una bozza cifrata, decifrandola e rimettendone i campi nel form. */
function apriBozzaRemota(identificatore_: string): void {
  const b = bozzeRemote.bozze.value.find((x) => x.identificatore === identificatore_)
  if (!b) return
  const template = bozzeRemote.apri(b)
  if (!template) return

  const definizione = getKindDefinition(template.kind)
  if (!definizione) return
  try {
    // Il template non e' firmato: si costruisce un evento fittizio per poterlo
    // far interpretare dalla definizione, che lavora su eventi completi.
    const dati = definizione.parse({
      ...template,
      id: '',
      pubkey: identita.pubkey ?? '',
      sig: '',
    } as never)
    titolo.value = dati.title ?? ''
    sommario.value = dati.summary ?? ''
    immagine.value = dati.image ?? ''
    hashtag.value = (dati.hashtags ?? []).join(' ')
    contenuto.value = dati.content
    identificatore.value = dati.identifier || identificatore_
    identificatoreManuale.value = true
    primaPubblicazione.value = dati.publishedAt ?? null
    bozza.azzera()
  } catch (e) {
    bozzeRemote.errore.value = e instanceof Error ? e.message : String(e)
  }
}

function apriBozza(identifier: string): void {
  const b = bozzeLocali.bozze.value.find((x) => x.identifier === identifier)
  if (!b) return
  titolo.value = b.title
  sommario.value = b.summary
  immagine.value = b.image
  hashtag.value = b.hashtag
  contenuto.value = b.content
  identificatore.value = b.identifier
  identificatoreManuale.value = true
  primaPubblicazione.value = b.publishedAt ?? null
  bozza.azzera()
}

/**
 * Riapre un articolo gia' pubblicato, leggendolo dai relay.
 *
 * La bozza locale ha la precedenza: se esiste, e' piu' recente di quanto sia
 * uscito, ed e' proprio il lavoro non ancora pubblicato che non va perso.
 * Senza bozza si scarica la versione pubblicata — prima questo caso non era
 * coperto e "Modifica" su un articolo pubblicato non faceva nulla.
 */
async function riapri(d: string): Promise<void> {
  if (bozzeLocali.bozze.value.some((b) => b.identifier === d)) {
    apriBozza(d)
    return
  }
  // Le bozze cifrate arrivano da un caricamento asincrono: si aspetta che sia
  // finito, altrimenti una bozza che sta arrivando risulterebbe inesistente.
  await bozzeRemote.pronte
  if (bozzeRemote.bozze.value.some((b) => b.identificatore === d)) {
    apriBozzaRemota(d)
    return
  }

  const trovato = await esistente.perCoordinata(30023, d)
  if (!trovato) return

  const definizione = getKindDefinition(30023)
  if (!definizione) return

  try {
    const dati = definizione.parse(trovato)
    titolo.value = dati.title ?? ''
    sommario.value = dati.summary ?? ''
    immagine.value = dati.image ?? ''
    hashtag.value = dati.hashtags.join(' ')
    contenuto.value = dati.content
    identificatore.value = dati.identifier
    // Da qui in avanti l'identificatore non deve piu' seguire il titolo:
    // cambiarlo creerebbe un articolo nuovo invece di sostituire questo.
    identificatoreManuale.value = true
    // La prima pubblicazione si conserva: e' cio' che distingue una correzione
    // da una ripubblicazione, e senza, l'articolo risalirebbe i feed altrui.
    primaPubblicazione.value = dati.publishedAt ?? trovato.created_at
    bozza.azzera()
  } catch (e) {
    esistente.errore.value = `L’articolo pubblicato non è interpretabile: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Arrivando da "modifica" nell'elenco, i campi si precompilano dalla query.
onMounted(() => {
  const d = rotta.query.d
  if (typeof d === 'string' && d) void riapri(d)
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">
          {{ modifica ? 'Modifica l’articolo' : 'Scrivi un articolo' }}
        </h1>
        <p class="mt-1 text-sm text-[var(--testo-tenue)]">Kind 30023 — long-form in Markdown.</p>
      </div>
      <BaseButton to="/articoli" variant="fantasma">← Torna agli articoli</BaseButton>
    </div>

    <ClientOnly>
      <div
        v-if="esistente.caricamento.value"
        class="superficie h-16 animate-pulse rounded-xl border"
      />
      <BaseAlert v-if="esistente.errore.value" tono="pericolo">
        {{ esistente.errore.value }}
      </BaseAlert>

      <BaseAlert v-if="identita.motivoNonFirmabile" tono="avviso">
        {{ identita.motivoNonFirmabile }}
        <NuxtLink to="/impostazioni" class="underline">Vai alle impostazioni</NuxtLink>
        . Puoi comunque scrivere e salvare la bozza in locale.
      </BaseAlert>

      <BaseCard
        v-if="bozzeRemote.bozze.value.length"
        title="Bozze cifrate sui relay"
        subtitle="Ti seguono su un altro dispositivo. Sul relay sono illeggibili."
      >
        <ul class="flex flex-col gap-2">
          <li
            v-for="b in bozzeRemote.bozze.value"
            :key="b.involucro"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span class="flex-1 truncate">{{ b.titolo }}</span>
            <span class="text-xs text-[var(--testo-tenue)]">
              {{ tempoRelativo(new Date(b.aggiornataAl * 1000)) }}
              <template v-if="b.scadenza">
                · scade {{ tempoRelativo(new Date(b.scadenza * 1000)) }}
              </template>
            </span>
            <BaseButton
              v-if="b.identificatore"
              size="sm"
              variant="fantasma"
              @click="apriBozzaRemota(b.identificatore)"
            >
              Apri
            </BaseButton>
            <BaseButton size="sm" variant="fantasma" @click="bozzeRemote.elimina(b)">
              Elimina
            </BaseButton>
          </li>
        </ul>
        <BaseAlert v-if="bozzeRemote.errore.value" tono="pericolo" class="mt-3">
          {{ bozzeRemote.errore.value }}
        </BaseAlert>
      </BaseCard>

      <BaseAlert v-else-if="bozzeRemote.senzaDestinazione.value" tono="info">
        Le bozze cifrate hanno bisogno di un
        <strong>relay privato</strong>
        : impostane uno alla voce «Relay per le bozze» nelle
        <NuxtLink to="/impostazioni" class="underline">impostazioni</NuxtLink>
        . Senza, restano solo quelle salvate in questo browser.
      </BaseAlert>

      <BaseAlert v-else-if="!bozzeRemote.disponibili.value && identita.autenticato" tono="info">
        {{ identita.motivoNonCifrabile }}
      </BaseAlert>

      <BaseCard v-if="bozzeLocali.bozze.value.length" title="Bozze salvate in questo browser">
        <ul class="flex flex-col gap-2">
          <li
            v-for="b in bozzeLocali.bozze.value"
            :key="b.identifier"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span class="flex-1 truncate">{{ b.title || b.identifier }}</span>
            <span class="text-xs text-[var(--testo-tenue)]">
              {{ tempoRelativo(new Date(b.salvataAlle)) }}
            </span>
            <BaseButton size="sm" variant="fantasma" @click="apriBozza(b.identifier)">
              Apri
            </BaseButton>
            <BaseButton size="sm" variant="fantasma" @click="bozzeLocali.elimina(b.identifier)">
              Elimina
            </BaseButton>
          </li>
        </ul>
      </BaseCard>
    </ClientOnly>

    <BaseCard>
      <form class="flex flex-col gap-4" @submit.prevent="componi">
        <BaseField v-slot="{ id, describedBy }" label="Titolo" required>
          <BaseInput :id="id" v-model="titolo" :described-by="describedBy" />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Identificatore"
          hint="È il tag d. Ripubblicando con lo stesso identificatore sostituisci l’articolo; cambiandolo ne crei uno nuovo."
        >
          <BaseInput
            :id="id"
            v-model="identificatore"
            :described-by="describedBy"
            @input="identificatoreManuale = true"
          />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Sommario"
          hint="Mostrato negli elenchi e nelle anteprime dei link."
        >
          <BaseTextarea :id="id" v-model="sommario" :rows="2" :described-by="describedBy" />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Immagine di copertina"
          hint="URL. Puoi caricarla dalla sezione media e incollare qui l’indirizzo."
        >
          <BaseInput
            :id="id"
            v-model="immagine"
            placeholder="https://…"
            :described-by="describedBy"
          />
        </BaseField>

        <BaseField
          v-slot="{ id, describedBy }"
          label="Hashtag"
          hint="Separati da spazio o virgola."
        >
          <BaseInput :id="id" v-model="hashtag" :described-by="describedBy" />
        </BaseField>

        <div class="flex items-center justify-between">
          <label class="text-sm font-medium" for="corpo">Testo (Markdown)</label>
          <button type="button" class="text-xs underline" @click="anteprima = !anteprima">
            {{ anteprima ? 'torna alla scrittura' : 'anteprima' }}
          </button>
        </div>

        <!--
          Il contenuto passa da renderMarkdown, che sanifica con DOMPurify. La
          sanificazione serve anche qui, dove NIP-23 vieta l'HTML: quel divieto
          vincola chi scrive, non chi legge, e in anteprima si rilegge testo che
          puo' arrivare da un'altra fonte.
        -->
        <!-- eslint-disable vue/no-v-html -->
        <div
          v-if="anteprima"
          class="prose-nmc superficie min-h-64 rounded-lg border p-4 text-sm"
          v-html="html"
        />
        <!-- eslint-enable vue/no-v-html -->
        <BaseTextarea
          v-else
          id="corpo"
          v-model="contenuto"
          :rows="18"
          placeholder="# Titolo della sezione&#10;&#10;Il testo va a capo da solo: non spezzare le righe a mano."
        />

        <p class="text-xs text-[var(--testo-tenue)]">
          {{ statistiche.parole }} parole · circa {{ statistiche.minuti }} min di lettura · niente
          HTML, lo vieta NIP-23
        </p>

        <div class="flex flex-wrap gap-2">
          <BaseButton type="submit" variant="primario" :disabled="!puoComporre">
            Componi evento
          </BaseButton>
          <BaseButton variant="secondario" @click="salvaBozza">
            {{ salvato ? 'Bozza salvata' : 'Salva bozza in locale' }}
          </BaseButton>
          <ClientOnly>
            <BaseButton
              variant="secondario"
              :loading="salvataggioRemoto || bozzeRemote.invio.inCorso.value"
              :disabled="!bozzeRemote.disponibili.value || bozzeRemote.senzaDestinazione.value"
              :title="
                bozzeRemote.senzaDestinazione.value
                  ? 'Serve un relay per le bozze, dalle impostazioni'
                  : (identita.motivoNonCifrabile ?? undefined)
              "
              @click="salvaBozzaRemota"
            >
              Salva bozza cifrata sul relay
            </BaseButton>
          </ClientOnly>
          <ClientOnly>
            <BaseButton
              v-if="bozza.template.value"
              variant="primario"
              :loading="bozza.inCorso.value || bozza.invio.inCorso.value"
              :disabled="!identita.puoFirmare"
              @click="bozza.firmaEPubblica()"
            >
              {{ bozza.firmato.value ? 'Pubblica' : 'Firma e pubblica' }}
            </BaseButton>
          </ClientOnly>
        </div>

        <PublishProgress :invio="bozza.invio" />

        <BaseAlert v-if="bozza.errore.value" tono="pericolo">{{ bozza.errore.value }}</BaseAlert>
      </form>
    </BaseCard>

    <BaseCard v-if="bozza.invio.esito.value" title="Esito della pubblicazione">
      <PublishResult :esito="bozza.invio.esito.value" />
    </BaseCard>

    <BaseCard v-if="bozza.template.value" title="Evento">
      <EventPreview :template="bozza.template.value" :firmato="bozza.firmato.value" />
    </BaseCard>

    <BaseAlert tono="info">
      Due tipi di bozza, con compromessi diversi. Quella
      <strong>in questo browser</strong>
      non esce di qui, ma non ti segue altrove. Quella
      <strong>cifrata</strong>
      (NIP-37, kind 31234) sta su un relay privato illeggibile a chi vi accede, e ti segue: in
      cambio serve una chiave capace di cifrare, e sul relay resta comunque traccia di quando
      scrivi. Il vecchio kind 30024 ci finiva
      <em>in chiaro</em>
      , ed è per questo che NIP-23 lo dichiara deprecato.
    </BaseAlert>
  </div>
</template>

<style scoped>
/*
 * Stili minimi per il testo renderizzato. Non usiamo un plugin tipografico:
 * qui servono cinque regole, e una dipendenza in piu' andrebbe poi tenuta
 * allineata al resto del tema.
 */
.prose-nmc :deep(h1),
.prose-nmc :deep(h2),
.prose-nmc :deep(h3) {
  font-weight: 600;
  margin: 1.2em 0 0.5em;
  line-height: 1.3;
}
.prose-nmc :deep(h1) {
  font-size: 1.5em;
}
.prose-nmc :deep(h2) {
  font-size: 1.25em;
}
.prose-nmc :deep(p) {
  margin: 0.8em 0;
  line-height: 1.7;
}
.prose-nmc :deep(ul),
.prose-nmc :deep(ol) {
  margin: 0.8em 0;
  padding-left: 1.4em;
  list-style: revert;
}
.prose-nmc :deep(a) {
  text-decoration: underline;
}
.prose-nmc :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
}
.prose-nmc :deep(pre) {
  overflow-x: auto;
  padding: 0.8em;
  border-radius: 0.5rem;
  background: var(--sfondo-alt);
}
.prose-nmc :deep(blockquote) {
  border-left: 3px solid var(--bordo-forte);
  padding-left: 1em;
  margin: 0.8em 0;
  color: var(--testo-tenue);
}
.prose-nmc :deep(img) {
  max-width: 100%;
  border-radius: 0.5rem;
}
</style>
