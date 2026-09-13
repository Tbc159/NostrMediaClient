import { describe, expect, it } from 'vitest'

import { riassumiFeedPodcast, urlFeedPodcast } from '../src/feed/index.js'

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
    ])
    expect(r.episodi).toEqual([])
  })

  it('rifiuta cio' + "' che non e' RSS, dicendolo", () => {
    expect(() => riassumiFeedPodcast('<html>404</html>')).toThrow(/Non e’ un feed RSS/)
  })
})
