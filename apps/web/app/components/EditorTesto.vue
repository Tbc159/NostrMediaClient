<script setup lang="ts">
/**
 * L'editor del corpo di un articolo: si scrive vedendo il risultato.
 *
 * Il contenuto pubblicato resta **Markdown** — lo vuole NIP-23 e lo vogliono i
 * lettori che non passano da qui — ma per scriverlo non serve conoscerne i
 * simboli: il grassetto appare in grassetto, i titoli sono grandi, e la barra
 * agisce sulla selezione. Il pulsante «Markdown» mostra la sorgente vera e la
 * lascia modificare, perche' chi la conosce fa prima a scriverla, e perche'
 * vedere cosa si sta pubblicando non deve essere un privilegio.
 *
 * **La sorgente e' sempre il Markdown.** Mentre si scrive formattato la fonte
 * momentanea e' il DOM, ma a ogni modifica si riscrive il Markdown e si emette
 * quello: nessuno stato nascosto che sopravviva al salvataggio.
 *
 * `document.execCommand` e' deprecato e viene usato comunque. La sostituzione
 * — ricostruire a mano selezione, annullamento e composizione da tastiera —
 * vale un editor a se', e nessun browser lo ha rimosso ne' ha annunciato di
 * farlo per i comandi elementari usati qui. La scelta e' consapevole: la
 * conseguenza e' che un domani si tocca solo questo file.
 */

const testo = defineModel<string>({ default: '' })

withDefaults(defineProps<{ righe?: number }>(), { righe: 18 })

const modo = ref<'formattato' | 'markdown'>('formattato')
const area = ref<HTMLElement | null>(null)
/** Vero mentre si riscrive l'HTML dall'esterno: evita di rispondere al proprio input. */
let scritturaInterna = false

const problemi = computed(() => costruttiNonRicostruibili(testo.value))

/*
 * Un articolo scritto con un altro editor puo' contenere cose che il giro
 * HTML → Markdown non ricostruisce. In quel caso si apre in Markdown e si
 * dice: semplificare in silenzio il lavoro di qualcuno e' il difetto peggiore
 * che un editor possa avere.
 */
onMounted(() => {
  if (problemi.value.length) modo.value = 'markdown'
  else riempiArea()
})

/** Markdown → HTML dentro l'area formattata. */
function riempiArea(): void {
  const el = area.value
  if (!el) return
  scritturaInterna = true
  el.innerHTML = renderMarkdown(testo.value) || '<p><br></p>'
  scritturaInterna = false
}

/** HTML → Markdown, a ogni modifica dell'area. */
function leggiArea(): void {
  const el = area.value
  if (!el || scritturaInterna) return
  testo.value = markdownDaHtml(el.innerHTML)
}

/*
 * Il Markdown cambiato da fuori (una bozza ripresa, un articolo riaperto) deve
 * comparire nell'area; quello cambiato *da* l'area no, altrimenti il cursore
 * salterebbe all'inizio a ogni carattere.
 *
 * **Qui vive anche la salvaguardia**, e non solo al montaggio: un articolo
 * riaperto arriva dai relay *dopo*, e un controllo fatto una volta sola al
 * montaggio vedrebbe sempre un testo vuoto. E' il difetto che la prova nel
 * browser ha trovato: la tabella compariva nell'editor formattato, pronta a
 * essere appiattita al primo salvataggio.
 */
watch(testo, () => {
  if (modo.value !== 'formattato') return
  const el = area.value
  if (!el) return
  // Cambiato da dentro: l'area e' gia' allineata, non si tocca nulla.
  if (markdownDaHtml(el.innerHTML) === testo.value) return
  if (problemi.value.length) {
    modo.value = 'markdown'
    return
  }
  riempiArea()
})

async function cambiaModo(): Promise<void> {
  if (modo.value === 'formattato') {
    leggiArea()
    modo.value = 'markdown'
    return
  }
  modo.value = 'formattato'
  await nextTick()
  riempiArea()
}

// ── La barra ──────────────────────────────────────────────────────────────

/** Esegue un comando sulla selezione e rilegge il Markdown. */
function comando(nome: string, valore?: string): void {
  area.value?.focus()
  document.execCommand(nome, false, valore)
  leggiArea()
}

/** Titolo: se il blocco e' gia' quel titolo, torna paragrafo. */
function titolo(livello: 'H2' | 'H3'): void {
  const dentro = bloccoCorrente() === livello
  comando('formatBlock', dentro ? 'P' : livello)
}

function citazione(): void {
  comando('formatBlock', bloccoCorrente() === 'BLOCKQUOTE' ? 'P' : 'BLOCKQUOTE')
}

/** Blocco di codice: `<pre>`, che turndown riscrive come recinto ```. */
function codiceBlocco(): void {
  comando('formatBlock', bloccoCorrente() === 'PRE' ? 'P' : 'PRE')
}

/**
 * Codice in riga: `execCommand` non ce l'ha, quindi si avvolge la selezione a
 * mano. Senza selezione non c'e' niente da marcare e si lascia stare.
 */
function codiceInRiga(): void {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !area.value) return
  const code = document.createElement('code')
  code.textContent = sel.toString()
  const range = sel.getRangeAt(0)
  range.deleteContents()
  range.insertNode(code)
  sel.removeAllRanges()
  leggiArea()
}

function link(): void {
  const sel = window.getSelection()
  const testoSelezionato = sel?.toString() ?? ''
  const url = window.prompt('Indirizzo del link', 'https://')
  if (!url) return
  if (testoSelezionato) comando('createLink', url)
  else comando('insertHTML', `<a href="${url}">${url}</a>`)
}

/** Il tag del blocco in cui sta il cursore, per i pulsanti che fanno da interruttore. */
function bloccoCorrente(): string {
  const sel = window.getSelection()
  let nodo = sel?.anchorNode ?? null
  while (nodo && nodo !== area.value) {
    if (nodo instanceof HTMLElement && /^(H[1-6]|BLOCKQUOTE|PRE|P|LI)$/.test(nodo.tagName)) {
      return nodo.tagName
    }
    nodo = nodo.parentNode
  }
  return ''
}

/** Scorciatoie: quelle che tutti si aspettano, piu' il link. */
function tasti(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'b') {
    e.preventDefault()
    comando('bold')
  } else if (k === 'i') {
    e.preventDefault()
    comando('italic')
  } else if (k === 'k') {
    e.preventDefault()
    link()
  }
}

/**
 * Incollare porta dentro l'HTML del posto da cui si copia, con i suoi stili e
 * a volte i suoi script. Si incolla il testo, che e' quello che serve.
 */
function incolla(e: ClipboardEvent): void {
  e.preventDefault()
  const piano = e.clipboardData?.getData('text/plain') ?? ''
  document.execCommand('insertText', false, piano)
  leggiArea()
}

const strumenti = [
  {
    etichetta: 'B',
    titolo: 'Grassetto (Ctrl+B)',
    azione: () => comando('bold'),
    classe: 'font-bold',
  },
  { etichetta: 'I', titolo: 'Corsivo (Ctrl+I)', azione: () => comando('italic'), classe: 'italic' },
  { etichetta: 'H2', titolo: 'Titolo di sezione', azione: () => titolo('H2'), classe: '' },
  { etichetta: 'H3', titolo: 'Sotto-titolo', azione: () => titolo('H3'), classe: '' },
  {
    etichetta: '•—',
    titolo: 'Elenco puntato',
    azione: () => comando('insertUnorderedList'),
    classe: '',
  },
  {
    etichetta: '1.',
    titolo: 'Elenco numerato',
    azione: () => comando('insertOrderedList'),
    classe: '',
  },
  { etichetta: '❝', titolo: 'Citazione', azione: citazione, classe: '' },
  { etichetta: '`', titolo: 'Codice in riga', azione: codiceInRiga, classe: 'font-mono' },
  { etichetta: '</>', titolo: 'Blocco di codice', azione: codiceBlocco, classe: 'font-mono' },
  { etichetta: '🔗', titolo: 'Link (Ctrl+K)', azione: link, classe: '' },
]
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1">
      <template v-if="modo === 'formattato'">
        <button
          v-for="s in strumenti"
          :key="s.etichetta"
          type="button"
          class="superficie rounded-md border px-2 py-1 text-xs hover:bg-[var(--sfondo-alt)]"
          :class="s.classe"
          :title="s.titolo"
          :aria-label="s.titolo"
          @click="s.azione"
        >
          {{ s.etichetta }}
        </button>
      </template>
      <span v-else class="text-xs text-[var(--testo-tenue)]">
        Stai scrivendo il Markdown vero: simboli compresi.
      </span>

      <button type="button" class="ml-auto text-xs underline" @click="cambiaModo">
        {{ modo === 'formattato' ? 'Markdown' : 'torna alla scrittura formattata' }}
      </button>
    </div>

    <BaseAlert v-if="problemi.length && modo === 'markdown'" tono="avviso">
      Questo testo contiene
      <strong>
        <template v-for="(p, i) in problemi" :key="p.nome">
          <template v-if="i > 0">,</template>
          {{ p.nome }} (riga {{ p.riga }})
        </template>
      </strong>
      : la scrittura formattata non li ricostruisce, e passando da lì il testo uscirebbe più povero
      di com’è adesso. Per questo resta in Markdown.
    </BaseAlert>

    <!--
      `contenteditable` con l'HTML prodotto da renderMarkdown, che passa da
      DOMPurify: quello che si scrive qui e' gia' ripulito, e quello che si
      incolla arriva come testo.
    -->
    <div
      v-if="modo === 'formattato'"
      ref="area"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      aria-label="Testo dell’articolo"
      class="prose-nmc superficie min-h-64 rounded-lg border p-4 text-sm focus:outline-2 focus:outline-[var(--accento)]"
      :style="{ minHeight: `${righe * 1.6}rem` }"
      @input="leggiArea"
      @keydown="tasti"
      @paste="incolla"
    />

    <BaseTextarea
      v-else
      id="corpo"
      v-model="testo"
      :rows="righe"
      placeholder="# Titolo della sezione&#10;&#10;Il testo va a capo da solo: non spezzare le righe a mano."
    />
  </div>
</template>
