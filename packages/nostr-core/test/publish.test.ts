import { describe, expect, it } from 'vitest'

import { mergeRelayLists, normalizeRelayUrl } from '../src/relays/pool.js'
import { spiegaRispostaRelay } from '../src/relays/publish.js'
import { ordinaPerData, ultimaVersione } from '../src/relays/request.js'
import type { NostrEvent } from '../src/kinds/types.js'

function evento(p: Partial<NostrEvent> & { id: string }): NostrEvent {
  return {
    pubkey: 'ab'.repeat(32),
    created_at: 1_800_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: '00'.repeat(64),
    ...p,
  } as NostrEvent
}

describe('lettura delle risposte dei relay', () => {
  it('si fida del booleano, non del prefisso', () => {
    // NIP-52 a parte, e' l'errore piu' facile da commettere qui: "duplicate:" e
    // "pow:" compaiono anche sulle risposte positive, e leggere solo il
    // prefisso farebbe segnalare come fallita una pubblicazione riuscita.
    expect(spiegaRispostaRelay(true, 'pow: difficulty 25>=24').esito).toBe('accettato')
    expect(spiegaRispostaRelay(false, 'pow: difficulty 26 is less than 30').esito).toBe('rifiutato')
  })

  it('tratta il duplicato come un successo', () => {
    // Il relay ce l'ha gia': per chi pubblica il risultato e' identico.
    const r = spiegaRispostaRelay(true, 'duplicate: already have this event')
    expect(r.esito).toBe('duplicato')
  })

  it('distingue la richiesta di autenticazione dal rifiuto', () => {
    // Sono due situazioni con rimedi opposti: una si risolve accedendo,
    // l'altra no.
    expect(
      spiegaRispostaRelay(false, 'auth-required: we only accept events from registered users')
        .esito,
    ).toBe('autenticazione')
    expect(spiegaRispostaRelay(false, 'restricted: not allowed to write.').esito).toBe('rifiutato')
  })

  it('riporta il testo grezzo quando il relay non usa alcun prefisso', () => {
    // La specifica lo impone, ma non tutti i relay la rispettano.
    const r = spiegaRispostaRelay(false, 'no.')
    expect(r.esito).toBe('rifiutato')
    expect(r.motivo).toBe('no.')
  })

  it('non lascia un messaggio vuoto senza spiegazione', () => {
    expect(spiegaRispostaRelay(false, '').motivo).toMatch(/senza motivo/)
    expect(spiegaRispostaRelay(false, undefined).motivo).toMatch(/senza motivo/)
  })

  it('classifica l' + "'errore del relay come irraggiungibilita', non come rifiuto", () => {
    // "error:" e' un guasto del relay, non un giudizio sull'evento: ritentare
    // ha senso, correggere l'evento no.
    expect(spiegaRispostaRelay(false, 'error: could not connect to the database').esito).toBe(
      'irraggiungibile',
    )
  })
})

describe('elenchi di relay', () => {
  it('non interroga due volte lo stesso relay scritto in modo diverso', () => {
    // Stesso URL con slash finale e maiuscole: due connessioni allo stesso
    // nodo si prendono un rate limit a vicenda.
    const uniti = mergeRelayLists(
      ['wss://uno.example/', 'wss://due.example'],
      ['WSS://UNO.EXAMPLE'],
    )
    expect(uniti).toHaveLength(2)
  })

  it('conserva la forma originale del primo URL incontrato', () => {
    // Normalizziamo per confrontare, non per riscrivere quello che l'utente ha
    // configurato.
    expect(mergeRelayLists(['wss://Uno.example'])[0]).toBe('wss://Uno.example')
    expect(normalizeRelayUrl('wss://Uno.example/')).toBe('wss://uno.example')
  })
})

describe('ricomposizione degli eventi letti', () => {
  const indirizzabile = (id: string, created_at: number, d = 'x'): NostrEvent =>
    evento({ id, created_at, kind: 31923, tags: [['d', d]] })

  it('tiene una sola versione di un evento sostituibile', () => {
    // Relay diversi possono avere versioni diverse: senza questo passaggio la
    // stessa riunione comparirebbe due volte in calendario.
    const risultato = ultimaVersione([indirizzabile('aa', 100), indirizzabile('bb', 200)])
    expect(risultato).toHaveLength(1)
    expect(risultato[0]?.id).toBe('bb')
  })

  it('a parita' + " di istante sceglie l'id minore, come vuole NIP-01", () => {
    // Non e' estetica: e' cio' che fa convergere client diversi sulla stessa
    // versione invece di mostrarne una a testa.
    const risultato = ultimaVersione([indirizzabile('bb', 100), indirizzabile('aa', 100)])
    expect(risultato[0]?.id).toBe('aa')
  })

  it('non fonde eventi addressable con identificatori diversi', () => {
    expect(
      ultimaVersione([indirizzabile('aa', 100, 'uno'), indirizzabile('bb', 100, 'due')]),
    ).toHaveLength(2)
  })

  it('non fonde le note, che sono regolari e tutte distinte', () => {
    const note = [evento({ id: 'aa', created_at: 100 }), evento({ id: 'bb', created_at: 100 })]
    expect(ultimaVersione(note)).toHaveLength(2)
  })

  it('ordina dal piu' + ' recente', () => {
    const ordinati = ordinaPerData([
      evento({ id: 'aa', created_at: 100 }),
      evento({ id: 'bb', created_at: 300 }),
      evento({ id: 'cc', created_at: 200 }),
    ])
    expect(ordinati.map((e) => e.id)).toEqual(['bb', 'cc', 'aa'])
  })
})
