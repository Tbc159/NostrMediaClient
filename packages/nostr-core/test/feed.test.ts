import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  episodiFuoriDalFeed,
  opmlPerFeed,
  riassumiFeedPodcast,
  urlFeedPodcast,
} from '../src/feed/index.js'

const FEED_VERO = readFileSync(
  new URL('./fixtures/feed-media-manager.xml', import.meta.url),
  'utf8',
)

const PUBKEY = 'ab'.repeat(32)

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<!-- relays: wss://nos.lol, wss://relay.damus.io -->
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title>News &amp; Test</title>
  <description><![CDATA[Uno show <b>di prova</b>]]></description>
  <language>it</language>
  <itunes:image href="https://blossom.example/cover.png"/>
  <itunes:explicit>false</itunes:explicit>
  <item>
    <title>Episodio 2</title>
    <pubDate>Sat, 12 Sep 2026 12:23:00 GMT</pubDate>
    <enclosure url="https://blossom.example/ep2.mpga" type="audio/mpeg" length="357945"/>
  </item>
  <item>
    <title>Episodio 1</title>
    <pubDate>Mon, 07 Sep 2026 14:47:00 GMT</pubDate>
    <enclosure url="https://blossom.example/ep1.mp3" type="audio/mpeg" length="0"/>
  </item>
</channel>
</rss>
<!-- saltati: 1 senza audio -->`

describe('URL del feed', () => {
  it('converte la chiave esadecimale in npub e aggiunge /v0/feed', () => {
    const url = urlFeedPodcast('https://mm.example/', PUBKEY)
    expect(url).toMatch(/^https:\/\/mm\.example\/v0\/feed\/npub1[a-z0-9]+\.xml$/)
  })

  it('accetta un npub e mette la lingua solo se non e' + "' quella predefinita", () => {
    expect(urlFeedPodcast('https://mm.example', 'npub1abc', 'it')).toBe(
      'https://mm.example/v0/feed/npub1abc.xml',
    )
    expect(urlFeedPodcast('https://mm.example', 'npub1abc', 'en')).toBe(
      'https://mm.example/v0/feed/npub1abc.xml?lang=en',
    )
  })
})

describe('riassunto di un feed', () => {
  it('legge canale ed episodi, decodificando entita' + "' e CDATA", () => {
    const r = riassumiFeedPodcast(FEED)
    expect(r.titolo).toBe('News & Test')
    expect(r.descrizione).toBe('Uno show <b>di prova</b>')
    expect(r.immagine).toBe('https://blossom.example/cover.png')
    expect(r.lingua).toBe('it')
    expect(r.episodi).toHaveLength(2)
    expect(r.episodi[0]?.titolo).toBe('Episodio 2')
    expect(r.episodi[0]?.data?.toISOString()).toBe('2026-09-12T12:23:00.000Z')
    expect(r.episodi[0]?.audioUrl).toBe('https://blossom.example/ep2.mpga')
    expect(r.episodi[0]?.byte).toBe(357945)
  })

  it('riporta i relay interrogati dal servizio: un feed vuoto si diagnostica da li' + "'", () => {
    expect(riassumiFeedPodcast(FEED).relays).toEqual(['wss://nos.lol', 'wss://relay.damus.io'])
  })

  it('segnala cio' + "' che un'app di podcast rifiuterebbe", () => {
    const r = riassumiFeedPodcast(FEED)
    expect(r.problemi).toContain(
      '1 episodi con length="0": il servizio non ha potuto misurare il file, alcune app li scartano',
    )
    expect(r.problemi).toContain('1 episodi saltati dal servizio perché senza audio')
  })

  it('un canale scarno elenca tutto quello che manca', () => {
    const r = riassumiFeedPodcast('<rss><channel><title>X</title></channel></rss>')
    expect(r.problemi).toEqual([
      'il canale non ha una descrizione',
      'manca l’immagine del canale: Apple e Podcast Index la pretendono',
      'manca la lingua del canale',
      'manca <itunes:explicit>, obbligatorio per Apple',
      'manca la categoria (itunes:category): Apple e Amazon la pretendono',
      'manca l’email dell’owner (itunes:email): Spotify, Amazon e YouTube verificano lì',
    ])
    expect(r.episodi).toEqual([])
  })

  it('rifiuta cio' + "' che non e' RSS, dicendolo", () => {
    expect(() => riassumiFeedPodcast('<html>404</html>')).toThrow(/Non e’ un feed RSS/)
  })
})

describe('il feed prodotto dal media-manager', () => {
  // La fixture e' quella del repository del servizio: quello che il lettore
  // capisce qui e' quello che arriva davvero.
  it('si legge per intero', () => {
    const r = riassumiFeedPodcast(FEED_VERO)
    expect(r.titolo).toBe('Radio Satoshi')
    expect(r.immagine).toBe('https://cdn.example.org/radio-satoshi.png')
    expect(r.lingua).toBe('it')
    expect(r.relays).toEqual(['wss://damus.example', 'wss://nos.example'])
    expect(r.episodi).toHaveLength(1)
    expect(r.episodi[0]?.id).toBe(
      '33d25dddc45e7ef190ec3c7bda204023651457887b0b055668cd89040539e203',
    )
    expect(r.episodi[0]?.byte).toBe(51200)
    // Il feed di oggi, prima del Prompt H: e' esattamente cio' che le
    // piattaforme rifiuterebbero, e il riassunto lo deve dire tutto.
    expect(r.problemi).toEqual([
      'manca la categoria (itunes:category): Apple e Amazon la pretendono',
      'manca l’email dell’owner (itunes:email): Spotify, Amazon e YouTube verificano lì',
      '<itunes:owner> senza <itunes:email>: il validatore lo rifiuta, va omesso o completato',
      '1 episodi saltati dal servizio perché senza audio',
      '1 episodi senza itunes:duration: le app mostrano una durata vuota',
    ])
    expect(r.categoria).toBeNull()
    expect(r.email).toBeNull()
    expect(r.explicit).toBe(false)
  })

  it('con categoria, email, explicit e durata il riassunto li riporta e non li segnala', () => {
    // La forma che il feed avra' dopo il Prompt H.
    const completo = FEED_VERO.replace(
      '<itunes:explicit>false</itunes:explicit>',
      `<itunes:category text="Society &amp; Culture"><itunes:category text="Documentary"/></itunes:category>
    <itunes:explicit>true</itunes:explicit>`,
    )
      .replace(
        '<itunes:owner>\n      <itunes:name>Alice Rossi</itunes:name>\n    </itunes:owner>',
        '<itunes:owner>\n      <itunes:name>Alice Rossi</itunes:name>\n      <itunes:email>alice@esempio.tld</itunes:email>\n    </itunes:owner>',
      )
      .replace(
        '<pubDate>Fri, 05 Sep 2025 19:20:00 +0000</pubDate>\n      <link>',
        '<pubDate>Fri, 05 Sep 2025 19:20:00 +0000</pubDate>\n      <itunes:duration>1235</itunes:duration>\n      <link>',
      )
    const r = riassumiFeedPodcast(completo)
    expect(r.categoria).toBe('Society & Culture')
    expect(r.email).toBe('alice@esempio.tld')
    expect(r.explicit).toBe(true)
    expect(r.problemi).toEqual(['1 episodi saltati dal servizio perché senza audio'])
  })

  it('dice quali episodi pubblicati non stanno nel feed', () => {
    const r = riassumiFeedPodcast(FEED_VERO)
    const fuori = episodiFuoriDalFeed(r, [
      { id: '33d25dddc45e7ef190ec3c7bda204023651457887b0b055668cd89040539e203', titolo: 'Ep 2' },
      { id: 'ff'.repeat(32), titolo: 'Ep 3, solo su nos.lol' },
    ])
    expect(fuori.map((e) => e.titolo)).toEqual(['Ep 3, solo su nos.lol'])
  })
})

describe('OPML', () => {
  it('contiene il feed come outline rss, con titolo e sito', () => {
    const o = opmlPerFeed({
      titolo: 'News & Test',
      urlFeed: 'https://mm.example/v0/feed/npub1abc.xml',
      sito: 'https://esempio.tld',
    })
    expect(o).toContain('<opml version="2.0">')
    expect(o).toContain(
      '<outline type="rss" text="News &amp; Test" title="News &amp; Test" xmlUrl="https://mm.example/v0/feed/npub1abc.xml" htmlUrl="https://esempio.tld"/>',
    )
  })

  it('senza titolo non produce un outline vuoto', () => {
    expect(opmlPerFeed({ titolo: '  ', urlFeed: 'https://x/f.xml' })).toContain('text="Podcast"')
  })
})
