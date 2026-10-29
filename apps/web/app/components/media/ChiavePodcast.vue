<script setup lang="ts">
import { passwordStrength } from '@nmc/nostr-core'

import type { SceltaChiave } from '~/composables/useChiaveDedicata'
import { useProfiloProprio } from '~/stores/profiloProprio'

/**
 * Which key the podcast lives on: the first question of a new show.
 *
 * NIP-F4 makes a podcast a key, so the answer is not a detail to change later:
 * the card, the episodes and the feed's identity all hang on it. Asked once,
 * explicitly, before anything is published — on the import and on the profile
 * page when the key has no card yet.
 */

const props = defineProps<{
  /** The show's title, when the page already has one: the new key is named after it. */
  titolo?: string
  immagine?: string
  descrizione?: string
  /** Why this identity cannot take the podcast, when it cannot. */
  bloccoQuesta?: string | null
  /** Runs before the switch, with the personal key still active: e.g. copying the cover. */
  primaDelPassaggio?: () => Promise<{ immagine?: string } | void>
}>()

const scelta = defineModel<SceltaChiave | null>({ default: null })

const emit = defineEmits<{
  /** The dedicated key is active; `autore` is the personal key, the show's host. */
  creata: [dati: { pubkey: string; autore: string; titolo: string }]
}>()

const identita = useIdentity()
const profilo = useProfiloProprio()
const chiave = useChiaveDedicata()

const nomeShow = ref(props.titolo ?? '')
watch(
  () => props.titolo,
  (t) => {
    if (t !== undefined) nomeShow.value = t
  },
)

const password = ref('')
const passwordConferma = ref('')
const errore = ref<string | null>(null)
const inCorso = ref(false)
const robustezza = computed(() => passwordStrength(password.value))
const coloreRobustezza = ['var(--pericolo)', 'var(--avviso)', 'var(--avviso)', 'var(--successo)']

// A choice that is no longer allowed is withdrawn rather than left standing.
watch(
  () => props.bloccoQuesta,
  (blocco) => {
    if (blocco && scelta.value === 'questa') scelta.value = null
  },
  { immediate: true },
)

const nomeIdentita = computed(() =>
  profilo.daProfilo && profilo.nome ? profilo.nome : `${identita.npub?.slice(0, 16)}…`,
)

function crea(): void {
  errore.value = null
  if (!nomeShow.value.trim()) {
    errore.value = 'Scrivi il nome del podcast: la nuova chiave prende il suo nome.'
    return
  }
  if (password.value !== passwordConferma.value) {
    errore.value = 'Le due password non coincidono.'
    return
  }
  if (password.value.length < 8) {
    errore.value = 'La password deve avere almeno 8 caratteri.'
    return
  }
  chiave.genera(password.value)
  password.value = ''
  passwordConferma.value = ''
}

const copiato = ref(false)
async function copiaNsec(): Promise<void> {
  if (!chiave.creata.value?.nsec) return
  try {
    await navigator.clipboard.writeText(chiave.creata.value.nsec)
    copiato.value = true
  } catch {
    errore.value = 'Il browser non ha permesso di copiare: selezionala e copiala a mano.'
  }
}

function scaricaBackup(): void {
  const file = chiave.backup(nomeShow.value)
  if (!file) return
  const url = URL.createObjectURL(new Blob([file.contenuto], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = file.nome
  a.click()
  URL.revokeObjectURL(url)
}

async function prosegui(): Promise<void> {
  errore.value = null
  inCorso.value = true
  try {
    const prima = (await props.primaDelPassaggio?.()) ?? {}
    const autore = identita.pubkey
    const pubkey = chiave.creata.value?.pubkey
    const fatto = await chiave.attiva({
      titolo: nomeShow.value,
      immagine: prima.immagine ?? props.immagine,
      descrizione: props.descrizione,
    })
    if (fatto && autore && pubkey) {
      emit('creata', { pubkey, autore, titolo: nomeShow.value.trim() })
    }
  } catch (e) {
    errore.value = e instanceof Error ? e.message : String(e)
  } finally {
    inCorso.value = false
  }
}

function annulla(): void {
  chiave.scarta()
  scelta.value = null
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <h3 class="font-semibold">Su quale chiave vive il podcast</h3>
    <p class="text-sm text-[var(--testo-tenue)]">
      Su Nostr un podcast è una chiave: scheda, episodi e identità del feed restano legati a quella
      che scegli adesso.
    </p>

    <BaseAlert v-if="chiave.completata.value" tono="successo">
      Ora sei sulla chiave del podcast «{{ nomeShow }}». La tua identità personale resta fra quelle
      salvate in questo browser: la ritrovi in «Cambia identità», in alto.
    </BaseAlert>

    <fieldset v-else class="flex flex-col gap-2 text-sm">
      <legend class="sr-only">Su quale chiave vive il podcast</legend>
      <label
        class="superficie flex gap-3 rounded-lg border p-3"
        :class="[
          scelta === 'questa' && 'border-[var(--accento)]',
          bloccoQuesta ? 'opacity-60' : 'cursor-pointer',
        ]"
      >
        <input
          v-model="scelta"
          type="radio"
          value="questa"
          class="mt-1"
          :disabled="!!bloccoQuesta || !!chiave.creata.value"
        />
        <span class="flex flex-col gap-1">
          <span class="font-medium">Questa identità ({{ nomeIdentita }})</span>
          <span class="text-xs text-[var(--testo-tenue)]">
            Il podcast diventa questa chiave. Il titolo dello show non cambia il nome del profilo, e
            «Autore nel feed» decide come firma il feed. Un podcast per chiave.
          </span>
          <span v-if="bloccoQuesta" class="text-xs text-[var(--pericolo)]">{{ bloccoQuesta }}</span>
        </span>
      </label>
      <label
        class="superficie flex cursor-pointer gap-3 rounded-lg border p-3"
        :class="scelta === 'dedicata' && 'border-[var(--accento)]'"
      >
        <input v-model="scelta" type="radio" value="dedicata" class="mt-1" />
        <span class="flex flex-col gap-1">
          <span class="font-medium">Una chiave dedicata, nuova</span>
          <span class="text-xs text-[var(--testo-tenue)]">
            Separa lo show dalla tua identità: puoi avere più podcast, e un giorno passarlo di mano.
            In cambio hai una chiave in più da tenere al sicuro. La tua chiave la dichiara come suo
            podcast, e la scheda ti nomina host.
          </span>
        </span>
      </label>
    </fieldset>

    <!-- ── Creating the dedicated key ── -->
    <template v-if="scelta === 'dedicata' && !chiave.completata.value">
      <form
        v-if="!chiave.creata.value"
        class="superficie flex flex-col gap-3 rounded-lg border p-4"
        @submit.prevent="crea"
      >
        <BaseField
          v-if="titolo === undefined"
          v-slot="{ id }"
          label="Nome del podcast"
          required
          hint="Diventa il nome del profilo della nuova chiave."
        >
          <BaseInput :id="id" v-model="nomeShow" />
        </BaseField>
        <BaseField
          v-slot="{ id, describedBy }"
          label="Password della nuova chiave"
          hint="La cifra in questo browser e nel file di backup. Non è recuperabile."
          required
        >
          <BaseInput
            :id="id"
            v-model="password"
            type="password"
            autocomplete="new-password"
            :described-by="describedBy"
          />
        </BaseField>
        <div v-if="password" class="flex items-center gap-2 text-xs">
          <div class="h-1 w-24 overflow-hidden rounded-full bg-[var(--sfondo-alt)]">
            <div
              class="h-full transition-all"
              :style="{
                width: `${((robustezza.score + 1) / 4) * 100}%`,
                backgroundColor: coloreRobustezza[robustezza.score],
              }"
            />
          </div>
          <span :style="{ color: coloreRobustezza[robustezza.score] }">{{ robustezza.label }}</span>
        </div>
        <BaseField v-slot="{ id }" label="Ripeti la password" required>
          <BaseInput
            :id="id"
            v-model="passwordConferma"
            type="password"
            autocomplete="new-password"
          />
        </BaseField>
        <BaseButton type="submit" variant="primario" class="w-fit">Crea la chiave</BaseButton>
      </form>

      <div v-else class="superficie flex flex-col gap-3 rounded-lg border p-4">
        <BaseAlert tono="pericolo">
          <strong>Questa è la chiave privata del podcast, e la vedi solo adesso.</strong>
          Chi la possiede possiede il podcast, per sempre: non esiste recupero. Copiala in un
          gestore di password, oppure scarica il backup cifrato.
        </BaseAlert>
        <template v-if="chiave.creata.value.nsec">
          <code class="break-all rounded-md bg-[var(--sfondo-alt)] p-2 text-xs">
            {{ chiave.creata.value.nsec }}
          </code>
          <div class="flex flex-wrap gap-2">
            <BaseButton size="sm" @click="copiaNsec">
              {{ copiato ? 'Copiata' : 'Copia la nsec' }}
            </BaseButton>
            <BaseButton size="sm" @click="scaricaBackup">Scarica il backup cifrato</BaseButton>
            <BaseButton size="sm" variant="fantasma" @click="chiave.nascondiNsec()">
              Nascondi
            </BaseButton>
          </div>
        </template>
        <p v-else class="text-sm text-[var(--testo-tenue)]">
          La nsec non è più visibile.
          <button type="button" class="underline" @click="scaricaBackup">
            Scarica il backup cifrato
          </button>
          se non l’hai ancora salvata.
        </p>
        <p class="text-xs text-[var(--testo-tenue)]">
          Chiave pubblica del podcast:
          <code class="break-all">{{ chiave.creata.value.npub }}</code>
        </p>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="chiave.messaAlSicuro.value" type="checkbox" />
          Ho messo al sicuro la chiave del podcast
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <BaseButton
            variant="primario"
            :loading="inCorso"
            :disabled="!chiave.messaAlSicuro.value || !identita.puoFirmare"
            @click="prosegui"
          >
            Prosegui con la nuova chiave
          </BaseButton>
          <BaseButton variant="fantasma" :disabled="inCorso" @click="annulla">Annulla</BaseButton>
        </div>
        <p v-if="chiave.fase.value" class="text-sm" aria-live="polite">{{ chiave.fase.value }}</p>
      </div>
    </template>

    <BaseAlert v-if="errore || chiave.errore.value" tono="pericolo">
      {{ errore ?? chiave.errore.value }}
    </BaseAlert>
  </section>
</template>
