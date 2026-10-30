import { compileTemplate } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

import { punteggiaturaAttaccata } from '../compiler/punteggiatura'

/**
 * The template as the server renders it, with and without the transform: the
 * static HTML is in the compiled code as written, so it can be read directly.
 */
function html(source: string, conTrasformazione = true): string {
  const { code, errors } = compileTemplate({
    source,
    filename: 'Prova.vue',
    id: 'prova',
    ssr: true,
    ...(conTrasformazione ? { compilerOptions: { nodeTransforms: [punteggiaturaAttaccata] } } : {}),
  })
  expect(errors).toEqual([])
  return code
}

describe('punctuation glued to the element next to it', () => {
  const comePrettier = `<p>
    il feed dichiara il nuovo in
    <code>itunes:new-feed-url</code>
    , per almeno quattro settimane.
  </p>`

  it('is what goes wrong without the transform', () => {
    expect(html(comePrettier, false)).toContain('</code> , per almeno')
  })

  it('drops the space before closing punctuation', () => {
    expect(html(comePrettier)).toContain('</code>, per almeno')
  })

  it('drops the space after opening punctuation, and before the closing one', () => {
    const out = html(`<p>
      Identità del podcast (
      <code>podcast:guid</code>
      ):
    </p>`)
    expect(out).toContain('(<code>podcast:guid</code>):')
  })

  it('works after a link, an interpolation and inside a v-if template', () => {
    const out = html(`<p>
      Prima configura i relay:
      <NuxtLink to="/impostazioni">Vai alle impostazioni</NuxtLink>
      . Poi {{ n }} episodi
      <template v-if="n">
        , l’ultimo del {{ data }}
      </template>
      .
    </p>`)
    expect(out).not.toMatch(/\s[.,]/)
  })

  it('leaves the spaces that belong to the text', () => {
    const out = html(`<p>
      Un testo
      <strong>forte</strong>
      e poi — una pausa — e «una citazione».
    </p>`)
    expect(out).toContain('Un testo <strong>forte</strong> e poi — una pausa — e «una citazione».')
  })

  it('does not touch a pre', () => {
    expect(
      html(`<pre>riga
  , rientrata</pre>`),
    ).toContain('riga\n  , rientrata')
  })
})
