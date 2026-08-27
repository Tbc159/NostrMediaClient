import DOMPurify from 'dompurify'
import { marked } from 'marked'

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
