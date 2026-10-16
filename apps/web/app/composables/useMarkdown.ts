import DOMPurify from 'dompurify'
import { marked } from 'marked'
import TurndownService from 'turndown'

/**
 * Markdown → HTML, sanitised.
 *
 * The sanitising is not optional even here, where NIP-23 forbids HTML inside
 * the Markdown: that prohibition binds *the writer*, not the reader, and an
 * event arrives from a relay that does not enforce it. Rendering without
 * cleaning up would mean running in the page whatever any author at all
 * decides to put in the content.
 *
 * DOMPurify works on the DOM, hence in the browser alone: in SSR the escaped
 * raw text is returned, which is inert.
 */
export function renderMarkdown(sorgente: string): string {
  const html = marked.parse(sorgente, { async: false, breaks: false, gfm: true }) as string

  if (!import.meta.client) {
    return sorgente.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    )
  }

  return DOMPurify.sanitize(html, {
    // `target` is what makes the links open elsewhere; without an explicit
    // ALLOWED_ATTR, DOMPurify would strip it along with the rest.
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  })
}

/** Numero di parole e minuti di lettura stimati. */
export function statisticheTesto(sorgente: string): { parole: number; minuti: number } {
  const parole = sorgente.trim().split(/\s+/).filter(Boolean).length
  // 200 words a minute: the conventional estimate for prose.
  return { parole, minuti: Math.max(1, Math.round(parole / 200)) }
}

// --- HTML → Markdown --------------------------------------------------------

/**
 * The return trip, for the editor that writes formatted.
 *
 * Writing while seeing the result means that the real source, while you
 * write, is the DOM: the Markdown has to be rebuilt from it. Turndown does
 * exactly that and nothing else, and it is configured to produce the same
 * dialect a person would write by hand — `#` for headings, `-` for lists,
 * `**` for bold — so an article that passes through here stays readable to
 * whoever reopens it with a text editor.
 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  strongDelimiter: '**',
  linkStyle: 'inlined',
})

/*
 * ProseMirror wraps the content of every list item in a `<p>`, and turndown
 * treats that as a block: out comes a blank line between the items, that is a
 * «loose» list, which when rendered takes up vertical space as though every
 * bullet were a paragraph. Here the paragraph inside an item is unwrapped: it
 * is the difference between `- one\n- two` and `- one\n\n- two`.
 */
turndown.addRule('paragrafoDentroVoce', {
  filter: (nodo) => nodo.nodeName === 'P' && nodo.parentNode?.nodeName === 'LI',
  replacement: (contenuto) => contenuto,
})

export function markdownDaHtml(html: string): string {
  return (
    turndown
      .turndown(html)
      // An empty paragraph in the editor becomes a line of spaces alone,
      // which in Markdown is not harmless: two spaces at the end of a line are
      // a line break. It is emptied, so what gets published is what you see.
      .replace(/^[ \t]+$/gm, '')
      // The surplus blank lines are the other noise turndown leaves, and
      // without this the text drifts away by itself on every round trip.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

// --- What the round trip cannot rebuild ------------------------------------

/**
 * The Markdown constructs that **do not survive** the Markdown → HTML →
 * Markdown round trip, and that therefore forbid opening an article in the
 * formatted editor.
 *
 * It is not generic caution: it is the same rule that holds for other clients'
 * tags. An article written elsewhere can contain a table or a footnote; if it
 * is opened in the formatted editor, what comes back is poorer than the
 * original — and whoever was only correcting a comma does not notice. Better
 * to open it in Markdown and say so.
 *
 * `marked` with `gfm` understands tables and strikethrough, but turndown
 * without plugins does not rewrite them; neither of the two understands
 * footnotes; DOMPurify strips raw HTML; and reference links become inline
 * links, leaving the definitions orphaned.
 */
export interface CostruttoNonRicostruibile {
  nome: string
  /** The first line it appears on, so it can be cited. */
  riga: number
}

const SPIE: { nome: string; prova: RegExp }[] = [
  { nome: 'tabelle', prova: /^\s*\|.*\|\s*$/ },
  { nome: 'note a piè di pagina', prova: /\[\^[^\]]+\]/ },
  { nome: 'HTML scritto a mano', prova: /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i },
  { nome: 'link per riferimento', prova: /^\s*\[[^\]]+\]:\s*\S+/ },
  { nome: 'elenchi di definizioni', prova: /^: {1,3}\S/ },
]

export function costruttiNonRicostruibili(markdown: string): CostruttoNonRicostruibile[] {
  const righe = markdown.split('\n')
  const trovati = new Map<string, number>()
  let dentroCodice = false

  righe.forEach((riga, i) => {
    // Inside a code block everything is text: a line with `|` is not a table,
    // and a `<div>` is an example, not HTML to render.
    if (/^\s*(```|~~~)/.test(riga)) dentroCodice = !dentroCodice
    if (dentroCodice) return
    for (const spia of SPIE) {
      if (!trovati.has(spia.nome) && spia.prova.test(riga)) trovati.set(spia.nome, i + 1)
    }
  })

  return [...trovati].map(([nome, riga]) => ({ nome, riga }))
}
