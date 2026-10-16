import { marked } from 'marked'
import { describe, expect, it } from 'vitest'

import { costruttiNonRicostruibili, markdownDaHtml } from '../app/composables/useMarkdown'

/**
 * The formatted editor's round trip: Markdown → HTML → Markdown.
 *
 * What counts is not that the conversion works in the abstract, but that the
 * text **comes back the same**: the editor rewrites the source on every
 * change, and a difference that accumulated on every round trip would take the
 * article away from how its author wrote it.
 *
 * The marked → turndown pair is tested here without DOMPurify, which wants a
 * DOM and lives in the browser: it is the conversion that can lose pieces, not
 * the sanitising.
 */

const html = (md: string): string =>
  marked.parse(md, { async: false, breaks: false, gfm: true }) as string
const giro = (md: string): string => markdownDaHtml(html(md))

describe('Markdown → HTML → Markdown', () => {
  it('brings back identical what the editor can write', () => {
    const md = [
      '## Titolo di sezione',
      '',
      '### Sotto-titolo',
      '',
      'Un paragrafo con **grassetto**, _corsivo_ e `codice` in riga.',
      '',
      '-   primo',
      '-   secondo',
      '',
      '1.  uno',
      '2.  due',
      '',
      '> Una citazione.',
      '',
      '```',
      'const x = 1',
      '```',
      '',
      'E un [link](https://esempio.tld).',
    ].join('\n')
    expect(giro(md)).toBe(md)
  })

  it('is stable: the second round trip changes nothing more', () => {
    // It is the property that really counts: the editor converts on every
    // keystroke, and a difference recurring on every round trip would make the
    // text grow.
    const uno = giro('# Titolo\n\nTesto con *corsivo* e - elenco\n- a\n- b')
    expect(giro(uno)).toBe(uno)
  })

  it('normalises the equivalent syntax instead of inventing content', () => {
    // `*corsivo*` becomes `_corsivo_`, a setext heading becomes `#`: the
    // symbol changes, not the text. It is the declared price of the formatted editor.
    expect(giro('*corsivo*')).toBe('_corsivo_')
    expect(giro('Titolo\n======')).toBe('# Titolo')
  })

  it('leaves no blank lines that pile up', () => {
    expect(giro('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it("does not loosen a list's items with blank lines", () => {
    // It is the form the editor produces: <li><p>…</p></li>. Without the rule,
    // a blank line is left between the items and the list becomes «loose».
    expect(markdownDaHtml('<ul><li><p>uno</p></li><li><p>due</p></li></ul>')).toBe(
      '-   uno\n-   due',
    )
    expect(markdownDaHtml('<ol><li><p>uno</p></li><li><p>due</p></li></ol>')).toBe(
      '1.  uno\n2.  due',
    )
  })

  it('does not turn an empty paragraph into a line of spaces', () => {
    // Two spaces at the end of a line, in Markdown, are a line break: a
    // paragraph left empty in the editor must not publish one.
    expect(markdownDaHtml('<p>a</p><p><br></p><p>b</p>')).toBe('a\n\nb')
  })
})

describe('costruttiNonRicostruibili', () => {
  it('finds nothing in an ordinary text', () => {
    expect(
      costruttiNonRicostruibili('# Titolo\n\nUn **testo** con [link](https://x.tld).'),
    ).toEqual([])
  })

  it('recognises a table and says on which line', () => {
    const md = 'Prima\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    expect(costruttiNonRicostruibili(md)).toEqual([{ nome: 'tabelle', riga: 3 }])
  })

  it('recognises footnotes, hand-written HTML and reference links', () => {
    const nomi = costruttiNonRicostruibili(
      'Testo con nota[^1].\n\n<div class="x">blocco</div>\n\n[rif]: https://x.tld\n\n[^1]: la nota',
    ).map((p) => p.nome)
    expect(nomi).toContain('note a piè di pagina')
    expect(nomi).toContain('HTML scritto a mano')
    expect(nomi).toContain('link per riferimento')
  })

  it('sees no constructs inside a code block: it is text, not syntax', () => {
    const md = 'Esempio:\n\n```\n| a | b |\n<div>ciao</div>\n```\n\nFine.'
    expect(costruttiNonRicostruibili(md)).toEqual([])
  })

  it('confirms a table really does not survive the round trip: that is why we warn', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |'
    expect(giro(md)).not.toContain('|')
  })
})
