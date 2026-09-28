<script setup lang="ts">
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'

/**
 * L'editor del corpo di un articolo: si scrive vedendo il risultato.
 *
 * Il contenuto pubblicato resta **Markdown** — lo vuole NIP-23 e lo vogliono i
 * lettori che non passano da qui — ma per scriverlo non serve conoscerne i
 * simboli. Il pulsante «Markdown» mostra la sorgente vera e la lascia
 * modificare: vedere cosa si sta pubblicando non deve essere un privilegio.
 *
 * **Perche' Tiptap e non un `contenteditable` nostro.** La prima versione
 * usava `document.execCommand`: titoli ed elenchi uscivano a caso, perche'
 * quell'API e' deprecata, si comporta in modo diverso a ogni browser e non ha
 * un modello del documento — sposta tag e spera. Tiptap sta su ProseMirror,
 * che ha uno schema vero: un titolo e' un nodo `heading`, un elenco e' un
 * nodo `bulletList`, e la selezione non puo' produrre stati impossibili. In
 * piu' i pulsanti sanno dire se sono attivi, e da tastiera funzionano le
 * scorciatoie che tutti conoscono.
 *
 * Nessuna tabella: `StarterKit` non ne ha, e non serve aggiungerle — un
 * articolo su Nostr e' testo, e il giro verso il Markdown non le
 * ricostruirebbe comunque.
 */

const testo = defineModel<string>({ default: '' })

withDefaults(defineProps<{ righe?: number }>(), { righe: 18 })

const modo = ref<'formattato' | 'markdown'>('formattato')
const problemi = computed(() => costruttiNonRicostruibili(testo.value))

/*
 * `useEditor` costruisce l'editor in `onMounted` e lo distrugge da solo: in SSR
 * non nasce affatto, che e' giusto — ProseMirror vuole un DOM, e renderizzarlo
 * sul server darebbe una pagina che non combacia con quella idratata.
 */
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      // Un articolo ha sezioni, non un titolo dentro il titolo: il titolo
      // dell'articolo e' un campo a parte, quindi qui si parte dall'H2.
      heading: { levels: [2, 3, 4] },
      link: false,
    }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  ],
  content: renderMarkdown(testo.value),
  editorProps: {
    attributes: {
      class: 'prose-nmc min-h-64 focus:outline-none',
      'aria-label': 'Testo dell’articolo',
    },
  },
  onUpdate: ({ editor: e }) => {
    // La sorgente pubblicata resta il Markdown: si riscrive a ogni modifica,
    // cosi' non esiste uno stato che sopravviva solo dentro l'editor.
    testo.value = markdownDaHtml(e.getHTML())
  },
})

/*
 * Il Markdown cambiato da fuori (una bozza ripresa, un articolo riaperto) deve
 * comparire nell'editor; quello che arriva **da** l'editor no, o il cursore
 * salterebbe all'inizio a ogni carattere.
 *
 * Qui vive anche la salvaguardia, e non al montaggio: un articolo riaperto
 * arriva dai relay *dopo*, e un controllo fatto una volta sola vedrebbe sempre
 * un testo vuoto. Era il difetto che la prova nel browser ha scoperto.
 */
watch(testo, (nuovo) => {
  const e = editor.value
  if (!e || markdownDaHtml(e.getHTML()) === nuovo) return
  if (problemi.value.length) {
    modo.value = 'markdown'
    return
  }
  e.commands.setContent(renderMarkdown(nuovo), { emitUpdate: false })
})

onMounted(() => {
  if (problemi.value.length) modo.value = 'markdown'
})

function cambiaModo(): void {
  if (modo.value === 'formattato') {
    modo.value = 'markdown'
    return
  }
  modo.value = 'formattato'
  // Rientrando, l'editor mostra cio' che si e' scritto a mano — e riprende il
  // fuoco con il cursore in fondo: chi torna dalla sorgente vuole continuare a
  // scrivere, non cercare dove ha lasciato.
  const e = editor.value
  if (!e) return
  e.chain().setContent(renderMarkdown(testo.value), { emitUpdate: false }).focus('end').run()
}

/**
 * Il link: si chiede l'indirizzo e si applica alla selezione.
 *
 * Senza selezione non c'e' testo da rendere cliccabile, e si inserisce
 * l'indirizzo come testo del link — che e' quello che si aspetta chi incolla
 * un URL in un messaggio.
 */
function link(): void {
  const e = editor.value
  if (!e) return
  const attuale = (e.getAttributes('link').href as string | undefined) ?? 'https://'
  const url = window.prompt('Indirizzo del link (vuoto per togliere)', attuale)
  if (url === null) return
  if (url.trim() === '') {
    e.chain().focus().unsetLink().run()
    return
  }
  if (e.state.selection.empty) {
    e.chain().focus().insertContent(`<a href="${url}">${url}</a>`).run()
    return
  }
  e.chain().focus().setLink({ href: url }).run()
}

/**
 * La barra: solo cio' che serve a scrivere un articolo, con i nomi che si
 * riconoscono. `attivo` accende il pulsante quando il cursore e' dentro quel
 * formato — senza, non si capisce se il grassetto e' acceso o spento.
 */
/*
 * `@mousedown.prevent` sui pulsanti della barra: senza, il clic toglie il fuoco
 * all'editor e il cursore si sposta, quindi il comando si applica al punto
 * sbagliato — o a niente. E' il pattern canonico di una barra ProseMirror, e
 * la ragione per cui un editor fatto a mano sbaglia proprio su titoli ed
 * elenchi, che agiscono sul blocco e non sulla parola.
 */
interface Strumento {
  nome: string
  etichetta: string
  scorciatoia?: string
  azione: () => void
  attivo?: () => boolean
  classe?: string
}

const strumenti = computed<Strumento[]>(() => {
  const e = editor.value
  if (!e) return []
  const c = () => e.chain().focus()
  return [
    {
      nome: 'Grassetto',
      etichetta: 'B',
      scorciatoia: 'Ctrl+B',
      classe: 'font-bold',
      azione: () => c().toggleBold().run(),
      attivo: () => e.isActive('bold'),
    },
    {
      nome: 'Corsivo',
      etichetta: 'I',
      scorciatoia: 'Ctrl+I',
      classe: 'italic',
      azione: () => c().toggleItalic().run(),
      attivo: () => e.isActive('italic'),
    },
    {
      nome: 'Titolo',
      etichetta: 'Titolo',
      azione: () => c().toggleHeading({ level: 2 }).run(),
      attivo: () => e.isActive('heading', { level: 2 }),
    },
    {
      nome: 'Sotto-titolo',
      etichetta: 'Sotto-titolo',
      azione: () => c().toggleHeading({ level: 3 }).run(),
      attivo: () => e.isActive('heading', { level: 3 }),
    },
    {
      nome: 'Elenco puntato',
      etichetta: '• Elenco',
      azione: () => c().toggleBulletList().run(),
      attivo: () => e.isActive('bulletList'),
    },
    {
      nome: 'Elenco numerato',
      etichetta: '1. Elenco',
      azione: () => c().toggleOrderedList().run(),
      attivo: () => e.isActive('orderedList'),
    },
    {
      nome: 'Citazione',
      etichetta: 'Citazione',
      azione: () => c().toggleBlockquote().run(),
      attivo: () => e.isActive('blockquote'),
    },
    {
      nome: 'Codice',
      etichetta: 'Codice',
      classe: 'font-mono',
      azione: () => c().toggleCode().run(),
      attivo: () => e.isActive('code'),
    },
    {
      nome: 'Link',
      etichetta: 'Link',
      scorciatoia: 'Ctrl+K',
      azione: link,
      attivo: () => e.isActive('link'),
    },
  ]
})

/*
 * Ctrl+K non e' fra le scorciatoie di Tiptap perche' il link ha bisogno di
 * chiedere l'indirizzo, e un'estensione non puo' aprire una finestra al posto
 * dell'applicazione.
 */
function tasti(evento: KeyboardEvent): void {
  if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
    evento.preventDefault()
    link()
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1">
      <template v-if="modo === 'formattato'">
        <button
          v-for="s in strumenti"
          :key="s.nome"
          type="button"
          class="superficie rounded-md border px-2 py-1 text-xs hover:bg-[var(--sfondo-alt)]"
          :class="[
            s.classe,
            s.attivo?.() ? 'border-[var(--accento)] bg-[var(--sfondo-alt)] font-semibold' : '',
          ]"
          :title="s.scorciatoia ? `${s.nome} (${s.scorciatoia})` : s.nome"
          :aria-label="s.nome"
          :aria-pressed="s.attivo?.() ?? false"
          @mousedown.prevent
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
      L'HTML iniziale passa da renderMarkdown, quindi da DOMPurify: quello che
      entra nell'editor e' gia' ripulito. Da qui in avanti il documento lo
      governa lo schema di ProseMirror, che accetta solo i nodi dichiarati
      sopra — e' il secondo motivo per cui l'HTML altrui non puo' passare.
    -->
    <div
      v-if="modo === 'formattato'"
      class="superficie rounded-lg border p-4 text-sm focus-within:outline-2 focus-within:outline-[var(--accento)]"
      @keydown="tasti"
    >
      <EditorContent :editor="editor" />
    </div>

    <BaseTextarea
      v-else
      id="corpo"
      v-model="testo"
      :rows="righe"
      placeholder="## Titolo della sezione&#10;&#10;Il testo va a capo da solo: non spezzare le righe a mano."
    />
  </div>
</template>
