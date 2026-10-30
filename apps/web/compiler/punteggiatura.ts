import type { CompilerOptions } from 'vue/compiler-sfc'

/**
 * Glues punctuation to the element next to it, in every template.
 *
 * Prettier runs with `htmlWhitespaceSensitivity: 'ignore'`, which puts every
 * inline element on a line of its own as soon as a paragraph is too long:
 *
 *     il feed dichiara il nuovo in
 *     <code>itunes:new-feed-url</code>
 *     , per almeno quattro settimane
 *
 * Vue condenses that line break into a space, and the page reads
 * «itunes:new-feed-url , per almeno». Moving the comma back in the source does
 * not last — the next format breaks the line again, even around a short
 * `(<code>…</code>)` — so the fix sits where the template is compiled: a text
 * that opens with spaces before closing punctuation loses them, and so does
 * one that ends with spaces after opening punctuation. Italian never wants a
 * space there, so nothing written on purpose is lost.
 *
 * It runs at build time only: the rendered pages carry no trace of it.
 */

type NodeTransform = NonNullable<CompilerOptions['nodeTransforms']>[number]

/** `NodeTypes.TEXT`: the enum lives in `@vue/compiler-core`, not a dependency of the app. */
const TESTO = 2

const SPAZI_PRIMA_DI_CHIUSA = /^\s+(?=[.,;:!?)\]»”…])/
const SPAZI_DOPO_APERTA = /([([«“])\s+$/

/** Where whitespace is content: left as written. */
const PRESERVANO = new Set(['pre', 'textarea'])

export const punteggiaturaAttaccata: NodeTransform = (node) => {
  if (!('children' in node) || !Array.isArray(node.children)) return
  if ('tag' in node && PRESERVANO.has(node.tag)) return
  for (const figlio of node.children as { type: number; content?: unknown }[]) {
    if (figlio.type !== TESTO || typeof figlio.content !== 'string') continue
    figlio.content = figlio.content
      .replace(SPAZI_PRIMA_DI_CHIUSA, '')
      .replace(SPAZI_DOPO_APERTA, '$1')
  }
}
