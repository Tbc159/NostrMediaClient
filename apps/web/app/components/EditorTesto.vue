<script setup lang="ts">
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'

/**
 * The editor for an article's body: you write while seeing the result.
 *
 * The published content stays **Markdown** — NIP-23 wants it and so do the
 * readers that do not come through here — but writing it requires no knowledge
 * of its symbols. The «Markdown» button shows the real source and lets it be
 * edited: seeing what you are publishing must not be a privilege.
 *
 * **Why Tiptap and not a `contenteditable` of our own.** The first version
 * used `document.execCommand`: headings and lists came out at random, because
 * that API is deprecated, behaves differently in every browser and has no
 * model of the document — it moves tags and hopes. Tiptap sits on ProseMirror,
 * which has a real schema: a heading is a `heading` node, a list is a
 * `bulletList` node, and the selection cannot produce impossible states. On
 * top of that the buttons can say whether they are active, and from the
 * keyboard the shortcuts everybody knows work.
 *
 * No tables: `StarterKit` has none, and there is no need to add them — an
 * article on Nostr is text, and the round trip to Markdown would not rebuild
 * them anyway.
 */

const testo = defineModel<string>({ default: '' })

withDefaults(defineProps<{ righe?: number }>(), { righe: 18 })

const modo = ref<'formattato' | 'markdown'>('formattato')
const problemi = computed(() => costruttiNonRicostruibili(testo.value))

/*
 * `useEditor` builds the editor in `onMounted` and destroys it by itself: in
 * SSR it is not born at all, which is right — ProseMirror wants a DOM, and
 * rendering it on the server would give a page that does not match the
 * hydrated one.
 */
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      // An article has sections, not a heading inside the heading: the
      // article's title is a field of its own, so here we start from the H2.
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
    // The published source stays the Markdown: it is rewritten on every
    // change, so no state survives inside the editor alone.
    testo.value = markdownDaHtml(e.getHTML())
  },
})

/*
 * Markdown changed from outside (a draft picked up again, an article reopened)
 * has to appear in the editor; what comes **from** the editor must not, or the
 * cursor would jump to the start on every character.
 *
 * The safeguard lives here too, and not on mount: a reopened article arrives
 * from the relays *later*, and a check made once only would always see an
 * empty text. It was the defect the test in the browser uncovered.
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
  // On the way back, the editor shows what was written by hand — and takes the
  // focus again with the cursor at the end: whoever returns from the source
  // wants to go on writing, not to look for where they left off.
  const e = editor.value
  if (!e) return
  e.chain().setContent(renderMarkdown(testo.value), { emitUpdate: false }).focus('end').run()
}

/**
 * The link: the address is asked for and applied to the selection.
 *
 * Without a selection there is no text to make clickable, and the address is
 * inserted as the link's text — which is what whoever pastes a URL into a
 * message expects.
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
 * The toolbar: only what is needed to write an article, with names that are
 * recognisable. `attivo` lights the button up when the cursor is inside that
 * format — without it, there is no telling whether bold is on or off.
 */
/*
 * `@mousedown.prevent` on the toolbar's buttons: without it the click takes
 * the focus away from the editor and the cursor moves, so the command applies
 * to the wrong place — or to nothing. It is the canonical pattern of a
 * ProseMirror toolbar, and the reason a hand-made editor gets headings and
 * lists wrong in particular, those acting on the block and not on the word.
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
 * Ctrl+K is not among Tiptap's shortcuts because the link needs to ask for the
 * address, and an extension cannot open a dialog on the application's behalf.
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
      The initial HTML goes through renderMarkdown, hence through DOMPurify:
      what enters the editor is cleaned up already. From here on the document
      is governed by ProseMirror's schema, which accepts only the nodes
      declared above — it is the second reason other people's HTML cannot get
      through.
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
