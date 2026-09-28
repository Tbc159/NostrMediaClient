import DOMPurify from 'dompurify'
import { marked } from 'marked'
import TurndownService from 'turndown'

/**
 * Markdown → HTML, sanificato.
 *
 * La sanificazione non e' facoltativa neanche qui, dove NIP-23 vieta l'HTML
 * dentro il Markdown: quel divieto vincola *chi scrive*, non chi legge, e un
 * evento arriva da un relay che non lo fa rispettare. Renderizzare senza
 * ripulire significherebbe eseguire in pagina qualunque cosa un autore
 * qualsiasi decida di mettere nel content.
 *
 * DOMPurify lavora sul DOM, quindi solo nel browser: in SSR si restituisce il
 * testo grezzo scappato, che e' inerte.
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
    // `target` serve a far aprire i link altrove; senza ALLOWED_ATTR esplicito
    // DOMPurify lo toglierebbe insieme al resto.
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
  })
}

/** Numero di parole e minuti di lettura stimati. */
export function statisticheTesto(sorgente: string): { parole: number; minuti: number } {
  const parole = sorgente.trim().split(/\s+/).filter(Boolean).length
  // 200 parole al minuto: la stima convenzionale per la prosa.
  return { parole, minuti: Math.max(1, Math.round(parole / 200)) }
}

// --- HTML → Markdown --------------------------------------------------------

/**
 * Il giro di ritorno, per l'editor che scrive formattato.
 *
 * Scrivere vedendo il risultato significa che la fonte vera, mentre si
 * scrive, e' il DOM: il Markdown va ricostruito da quello. Turndown fa
 * esattamente questo e nient'altro, ed e' configurato per produrre lo stesso
 * dialetto che scriverebbe una persona a mano — `#` per i titoli, `-` per gli
 * elenchi, `**` per il grassetto — cosi' un articolo che passa da qui resta
 * leggibile anche a chi lo riapre con un editor di testo.
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
 * ProseMirror avvolge il contenuto di ogni voce di elenco in un `<p>`, e
 * turndown lo tratta come un blocco: ne esce una riga vuota fra le voci, cioe'
 * un elenco «largo», che al rendering prende spazio verticale come se ogni
 * punto fosse un paragrafo. Qui il paragrafo dentro una voce si sciogle: e' la
 * differenza fra `- uno\n- due` e `- uno\n\n- due`.
 */
turndown.addRule('paragrafoDentroVoce', {
  filter: (nodo) => nodo.nodeName === 'P' && nodo.parentNode?.nodeName === 'LI',
  replacement: (contenuto) => contenuto,
})

export function markdownDaHtml(html: string): string {
  return (
    turndown
      .turndown(html)
      // Un paragrafo vuoto nell'editor diventa una riga di soli spazi, che in
      // Markdown non e' innocua: due spazi a fine riga sono un'interruzione
      // di riga. Si svuota, cosi' cio' che si pubblica e' quello che si vede.
      .replace(/^[ \t]+$/gm, '')
      // Le righe vuote in eccesso sono l'altro rumore che turndown lascia, e
      // senza questo il testo si allontana da solo a ogni giro.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

// --- Cosa il giro non sa ricostruire ---------------------------------------

/**
 * Costrutti Markdown che **non sopravvivono** al giro Markdown → HTML →
 * Markdown, e che quindi vietano di aprire un articolo nell'editor
 * formattato.
 *
 * Non e' prudenza generica: e' la stessa regola che vale per i tag degli altri
 * client. Un articolo scritto altrove puo' contenere una tabella o una nota a
 * pie' di pagina; se lo si apre nell'editor formattato, quello che torna
 * indietro e' piu' povero dell'originale — e chi stava solo correggendo una
 * virgola non se ne accorge. Meglio aprirlo in Markdown e dirlo.
 *
 * `marked` con `gfm` capisce tabelle e barrato, ma turndown senza plugin non
 * li riscrive; le note a pie' di pagina non le capisce nessuno dei due;
 * l'HTML grezzo lo toglie DOMPurify; i link per riferimento diventano link
 * in linea e le definizioni restano orfane.
 */
export interface CostruttoNonRicostruibile {
  nome: string
  /** Prima riga in cui compare, per poterla citare. */
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
    // Dentro un blocco di codice tutto e' testo: una riga con `|` non e' una
    // tabella, e un `<div>` e' un esempio, non HTML da rendere.
    if (/^\s*(```|~~~)/.test(riga)) dentroCodice = !dentroCodice
    if (dentroCodice) return
    for (const spia of SPIE) {
      if (!trovati.has(spia.nome) && spia.prova.test(riga)) trovati.set(spia.nome, i + 1)
    }
  })

  return [...trovati].map(([nome, riga]) => ({ nome, riga }))
}
