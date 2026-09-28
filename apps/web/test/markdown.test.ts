import { marked } from 'marked'
import { describe, expect, it } from 'vitest'

import { costruttiNonRicostruibili, markdownDaHtml } from '../app/composables/useMarkdown'

/**
 * Il giro dell'editor formattato: Markdown → HTML → Markdown.
 *
 * Quello che conta non e' che la conversione funzioni in astratto, ma che il
 * testo **torni uguale**: l'editor riscrive la sorgente a ogni modifica, e una
 * differenza che si accumula a ogni giro allontanerebbe l'articolo da come
 * l'ha scritto il suo autore.
 *
 * Qui si prova la coppia marked → turndown senza DOMPurify, che vuole un DOM e
 * vive nel browser: e' la conversione a poter perdere pezzi, non la
 * sanificazione.
 */

const html = (md: string): string =>
  marked.parse(md, { async: false, breaks: false, gfm: true }) as string
const giro = (md: string): string => markdownDaHtml(html(md))

describe('Markdown → HTML → Markdown', () => {
  it('riporta indietro identico ciò che l’editor sa scrivere', () => {
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

  it('è stabile: il secondo giro non cambia più nulla', () => {
    // E' la proprieta' che conta davvero: l'editor converte a ogni tasto, e
    // una differenza che si ripresenta a ogni giro farebbe crescere il testo.
    const uno = giro('# Titolo\n\nTesto con *corsivo* e - elenco\n- a\n- b')
    expect(giro(uno)).toBe(uno)
  })

  it('normalizza la sintassi equivalente invece di inventare contenuto', () => {
    // `*corsivo*` diventa `_corsivo_`, un titolo setext diventa `#`: cambia il
    // simbolo, non il testo. E' il prezzo dichiarato dell'editor formattato.
    expect(giro('*corsivo*')).toBe('_corsivo_')
    expect(giro('Titolo\n======')).toBe('# Titolo')
  })

  it('non lascia righe vuote che si accumulano', () => {
    expect(giro('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('un paragrafo vuoto non diventa una riga di spazi', () => {
    // Due spazi a fine riga, in Markdown, sono un'interruzione di riga: un
    // paragrafo lasciato vuoto nell'editor non deve pubblicarne una.
    expect(markdownDaHtml('<p>a</p><p><br></p><p>b</p>')).toBe('a\n\nb')
  })
})

describe('costruttiNonRicostruibili', () => {
  it('non trova nulla in un testo normale', () => {
    expect(
      costruttiNonRicostruibili('# Titolo\n\nUn **testo** con [link](https://x.tld).'),
    ).toEqual([])
  })

  it('riconosce una tabella e dice a quale riga', () => {
    const md = 'Prima\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    expect(costruttiNonRicostruibili(md)).toEqual([{ nome: 'tabelle', riga: 3 }])
  })

  it('riconosce note a piè di pagina, HTML a mano e link per riferimento', () => {
    const nomi = costruttiNonRicostruibili(
      'Testo con nota[^1].\n\n<div class="x">blocco</div>\n\n[rif]: https://x.tld\n\n[^1]: la nota',
    ).map((p) => p.nome)
    expect(nomi).toContain('note a piè di pagina')
    expect(nomi).toContain('HTML scritto a mano')
    expect(nomi).toContain('link per riferimento')
  })

  it('dentro un blocco di codice non vede costrutti: è testo, non sintassi', () => {
    const md = 'Esempio:\n\n```\n| a | b |\n<div>ciao</div>\n```\n\nFine.'
    expect(costruttiNonRicostruibili(md)).toEqual([])
  })

  it('una tabella davvero non sopravvive al giro: è per questo che si avvisa', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |'
    expect(giro(md)).not.toContain('|')
  })
})
