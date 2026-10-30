import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { confrontaFeed, riassumiFeedPodcast, testoDaHtml } from '../src/feed/index.js'
import { accettaUpload } from '../src/media/blossom.js'
import { TIPO_AUDIO, scaricaFile } from '../src/media/download.js'
import {
  durataInSecondi,
  leggiFeedEsterno,
  paginaDiPiattaforma,
  type EsitoImport,
} from '../src/podcast/import.js'

/**
 * Reading another host's feed to move the podcast to NMC, and checking before
 * the redirect that nothing is lost. The Anchor fixture is the real test feed
 * from Spotify for Creators; the others are synthetic and cover what that show
 * does not have.
 */

const leggi = (nome: string): string =>
  readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8')

const ANCHOR = leggi('anchor-feed.xml')
const COMPLETO = leggi('feed-completo.xml')
const BLOCCATO = leggi('feed-bloccato.xml')
const URL_ANCHOR = 'https://anchor.fm/s/117e26658/podcast/rss'

function aperto(esito: EsitoImport): Extract<EsitoImport, { bloccato: false }> {
  if (esito.bloccato) throw new Error('il feed risulta bloccato')
  return esito
}

describe('importing the real Spotify feed', () => {
  it('reads the two episodes oldest first, with their GUIDs, dates and durations', async () => {
    const esito = aperto(await leggiFeedEsterno(ANCHOR, URL_ANCHOR))
    expect(esito.episodi.map((e) => e.guid)).toEqual([
      '5b0a0828-92a6-4c14-a656-ea81951dd6f0',
      'f666a2ad-c531-4868-ae1a-da55e791fe65',
    ])
    expect(esito.episodi.map((e) => e.publishedAt)).toEqual([
      Date.parse('Tue, 29 Sep 2026 09:35:05 GMT') / 1000,
      Date.parse('Tue, 27 Oct 2026 13:34:42 GMT') / 1000,
    ])
    expect(esito.episodi.map((e) => e.durata)).toEqual([297, 270])
  })

  it('inherits the identity computed from the feed’s address, and says so', async () => {
    const esito = aperto(await leggiFeedEsterno(ANCHOR, URL_ANCHOR))
    expect(esito.podcast.podcastGuid).toBe('2977094a-c6b7-5d6c-9886-e3337ff33d87')
    expect(esito.podcast.podcastGuidCalcolato).toBe(true)
    expect(esito.avvisi.map((a) => a.codice)).toContain('guid-calcolato')
  })

  it('takes the identity from the feed’s self link even when the URL is not given', async () => {
    // A pasted XML still knows where it lives.
    const esito = aperto(await leggiFeedEsterno(ANCHOR))
    expect(esito.podcast.podcastGuid).toBe('2977094a-c6b7-5d6c-9886-e3337ff33d87')
  })

  it('reads the show card, and warns that the owner email is empty', async () => {
    const esito = aperto(await leggiFeedEsterno(ANCHOR, URL_ANCHOR))
    expect(esito.podcast).toMatchObject({
      titolo: 'Brevi articoli test',
      lingua: 'it',
      autore: 'ThebC',
      tipo: 'episodic',
      categoria: { principale: 'Technology' },
      explicit: false,
    })
    expect(esito.podcast.email).toBeUndefined()
    expect(esito.avvisi.map((a) => a.codice)).toContain('email-vuota')
  })

  it('turns the HTML descriptions into text, and keeps the HTML for the notes', async () => {
    const esito = aperto(await leggiFeedEsterno(ANCHOR, URL_ANCHOR))
    const ultimo = esito.episodi[1]!
    expect(ultimo.descrizione).not.toMatch(/<p>/)
    expect(ultimo.descrizione).toMatch(/^Mentre l’Europa/)
    expect(ultimo.contenutoHtml).toMatch(/<p>/)
    expect(esito.avvisi.map((a) => a.codice)).toContain('html-descrizioni')
  })

  it('adds up the weight to copy', async () => {
    const esito = aperto(await leggiFeedEsterno(ANCHOR, URL_ANCHOR))
    expect(esito.pesoTotale).toBe(4806001 + 4376759)
    expect(esito.episodiSenzaPeso).toBe(0)
    expect(esito.nonRiportati).toEqual([])
  })
})

describe('importing a complete feed', () => {
  it('reads a serial show, its numbering and the episode types', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    expect(esito.podcast.tipo).toBe('serial')
    expect(esito.episodi.map((e) => [e.titolo, e.stagione, e.numero, e.tipoEpisodio])).toEqual([
      ['Trailer', 1, undefined, 'trailer'],
      ['1. Il whitepaper', 1, 1, 'full'],
      ['2. Il blocco genesi', 1, 2, undefined],
    ])
  })

  it('inherits a declared podcast:guid as it is', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    expect(esito.podcast.podcastGuid).toBe('c90e609a-df1e-596a-bd5e-57bcc8aad6cc')
    expect(esito.podcast.podcastGuidCalcolato).toBe(false)
  })

  it('reads the category with its sub-category and the decoded ampersand', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    expect(esito.podcast.categoria).toEqual({
      principale: 'Society & Culture',
      sotto: 'Documentary',
    })
    expect(esito.podcast.email).toBe('maria@esempio.it')
  })

  it('reads every recipient of the show’s split, the old host’s fee included', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    expect(esito.podcast.valore).toMatchObject({
      tipo: 'lightning',
      metodo: 'keysend',
      suggerito: '0.00000005000',
    })
    expect(esito.podcast.valore?.destinatari.map((d) => [d.nome, d.quota, d.fee])).toEqual([
      ['Maria Rossi', 95, false],
      ['VecchioHost', 5, true],
    ])
  })

  it('keeps the episode’s own split apart from the show’s', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    const ep1 = esito.episodi[1]!
    expect(ep1.valore?.destinatari.map((d) => d.nome)).toEqual(['Maria Rossi', 'Luca Bianchi'])
    expect(esito.episodi[0]!.valore).toBeUndefined()
  })

  it('reads transcripts, chapters, people and funding', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    const ep1 = esito.episodi[1]!
    expect(ep1.trascrizioni).toEqual([
      { url: 'https://vecchiohost.example/t/ep1.vtt', mime: 'text/vtt' },
      { url: 'https://vecchiohost.example/t/ep1.srt', mime: 'application/x-subrip' },
    ])
    expect(ep1.capitoli).toEqual({
      url: 'https://vecchiohost.example/c/ep1.json',
      mime: 'application/json+chapters',
    })
    expect(ep1.persone).toEqual([
      { nome: 'Luca Bianchi', ruolo: 'guest', link: 'https://ospite.example' },
    ])
    expect(esito.podcast.persone[0]).toMatchObject({ nome: 'Maria Rossi', ruolo: 'host' })
    expect(esito.podcast.finanziamenti).toEqual([
      { url: 'https://storiedibitcoin.example/sostieni', testo: 'Sostieni la serie' },
    ])
  })

  it('lists what it does not carry, with how many episodes use it', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    expect(esito.nonRiportati).toEqual([
      { tag: 'podcast:alternateEnclosure', nelCanale: false, episodi: 1 },
      { tag: 'podcast:license', nelCanale: true, episodi: 0 },
      { tag: 'podcast:location', nelCanale: true, episodi: 0 },
      { tag: 'podcast:soundbite', nelCanale: false, episodi: 2 },
    ])
  })

  it('warns about an episode without a GUID, and leaves out an undeclared weight', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    expect(esito.avvisi.find((a) => a.codice === 'senza-guid')?.episodio).toBe(
      '2. Il blocco genesi',
    )
    expect(esito.pesoTotale).toBe(1200000 + 48000000)
    expect(esito.episodiSenzaPeso).toBe(1)
  })

  it('decodes numeric entities in the descriptions', async () => {
    const esito = aperto(await leggiFeedEsterno(COMPLETO))
    expect(esito.podcast.descrizione).toBe('Una serie in dieci puntate sull’origine di Bitcoin.')
    expect(esito.episodi[1]!.descrizione).toBe('Il 31 ottobre 2008 arriva un’email.\nSeconda riga.')
  })
})

describe('a locked feed', () => {
  it('stops the import and names the owner', async () => {
    const esito = await leggiFeedEsterno(BLOCCATO)
    expect(esito).toEqual({ bloccato: true, proprietario: 'proprietario@esempio.it' })
  })

  it('does not stop on podcast:locked set to no', async () => {
    expect((await leggiFeedEsterno(COMPLETO)).bloccato).toBe(false)
  })

  it('refuses what is not RSS', async () => {
    await expect(leggiFeedEsterno('<html></html>')).rejects.toThrow(/feed RSS/)
    await expect(leggiFeedEsterno('{"title":"x"}')).rejects.toThrow(/^Non è un feed RSS/)
  })

  it('tells a web page from a feed, and says where the feed is', async () => {
    await expect(
      leggiFeedEsterno('<!DOCTYPE html><html><head><title>Show</title></head></html>'),
    ).rejects.toThrow(/^Questa è una pagina web, non un feed RSS\..*pannello del tuo host/)
  })
})

describe('paginaDiPiattaforma', () => {
  it('recognises a show page on each platform, and says where the feed is', () => {
    const spotify = paginaDiPiattaforma('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk')
    expect(spotify).toMatch(/^Questo è il link dello show su Spotify, non il feed RSS\./)
    expect(spotify).toContain('https://anchor.fm/s/')
    expect(paginaDiPiattaforma('https://podcasts.apple.com/it/podcast/brevi/id1234567890')).toMatch(
      /^Questo è il link dello show su Apple Podcasts.*Apple Podcasts Connect/,
    )
    expect(paginaDiPiattaforma('https://music.amazon.it/podcasts/abc')).toMatch(/Amazon Music/)
    expect(paginaDiPiattaforma('https://www.youtube.com/@brevi/podcasts')).toMatch(/YouTube/)
    expect(paginaDiPiattaforma('https://podcastindex.org/podcast/123')).toMatch(
      /^Questa è la pagina dello show su Podcast Index/,
    )
    expect(paginaDiPiattaforma('https://creators.spotify.com/pod/show/brevi')).toMatch(
      /^Questo è l’indirizzo di una pagina di Spotify for Creators/,
    )
  })

  it('lets real feeds through, from the host or anywhere else', () => {
    expect(paginaDiPiattaforma('https://anchor.fm/s/117e26658/podcast/rss')).toBeNull()
    expect(paginaDiPiattaforma('https://feeds.buzzsprout.com/123456.rss')).toBeNull()
    expect(
      paginaDiPiattaforma('https://www.youtube.com/feeds/videos.xml?playlist_id=PL123'),
    ).toBeNull()
    expect(paginaDiPiattaforma('https://esempio.it/podcast')).toBeNull()
    expect(paginaDiPiattaforma('non un indirizzo')).toBeNull()
  })
})

describe('durataInSecondi', () => {
  it('reads HH:MM:SS, MM:SS and plain seconds', () => {
    expect(durataInSecondi('1:02:03')).toBe(3723)
    expect(durataInSecondi('00:04:30')).toBe(270)
    expect(durataInSecondi('12:30')).toBe(750)
    expect(durataInSecondi('754')).toBe(754)
    expect(durataInSecondi('754.6')).toBe(755)
  })

  it('gives nothing for what is not a duration', () => {
    expect(durataInSecondi('lunga')).toBeUndefined()
    expect(durataInSecondi('0')).toBeUndefined()
    expect(durataInSecondi('1:2:3:4')).toBeUndefined()
  })
})

describe('testoDaHtml', () => {
  it('keeps paragraphs and line breaks as new lines, and drops the tags', () => {
    expect(testoDaHtml('<p>Uno <strong>due</strong></p><p>tre<br/>quattro</p>')).toBe(
      'Uno due\ntre\nquattro',
    )
  })
})

/** An NMC feed equivalent to the Anchor one, as the service will produce it after Prompt K. */
function feedNmc(modifica: (xml: string) => string = (x) => x): string {
  const xml = `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Brevi articoli test</title>
    <description>Generazione di episodio podcast da articoli scritti da autori noti, per testare la divulgazione di contenuti sotto nuove forme</description>
    <atom:link href="https://feed.esempio.it/podcast.xml" rel="self" type="application/rss+xml"/>
    <itunes:new-feed-url>https://feed.esempio.it/podcast.xml</itunes:new-feed-url>
    <podcast:guid>2977094a-c6b7-5d6c-9886-e3337ff33d87</podcast:guid>
    <itunes:image href="https://blossom.example/c.jpg"/>
    <language>it</language>
    <itunes:explicit>false</itunes:explicit>
    <item>
      <title>S00E02 - Europa inasprisce il MiCA in nome della "protezione"</title>
      <guid isPermaLink="false">f666a2ad-c531-4868-ae1a-da55e791fe65</guid>
      <pubDate>Tue, 27 Oct 2026 13:34:42 +0000</pubDate>
      <enclosure url="https://blossom.example/b.m4a" length="4376759" type="audio/mp4"/>
      <itunes:duration>270</itunes:duration>
    </item>
    <item>
      <title>S00E01 - Nostr: dai live audio all’innovazione senza permesso</title>
      <guid isPermaLink="false">5b0a0828-92a6-4c14-a656-ea81951dd6f0</guid>
      <pubDate>Tue, 29 Sep 2026 09:35:05 +0000</pubDate>
      <enclosure url="https://blossom.example/a.m4a" length="4806001" type="audio/mp4"/>
      <itunes:duration>297</itunes:duration>
    </item>
  </channel>
</rss>`
  return modifica(xml)
}

describe('confrontaFeed — the parity check before the redirect', () => {
  const vecchio = riassumiFeedPodcast(ANCHOR)

  it('finds full parity with an equivalent NMC feed', async () => {
    const esito = await confrontaFeed(vecchio, riassumiFeedPodcast(feedNmc()), {
      urlVecchio: URL_ANCHOR,
    })
    expect(esito).toEqual({ sicuro: true, differenze: [] })
  })

  it('takes the old show’s identity from the address its feed declares, as the import does', async () => {
    // The same Anchor feed, read from a copy elsewhere: still the Anchor show.
    const esito = await confrontaFeed(vecchio, riassumiFeedPodcast(feedNmc()), {
      urlVecchio: 'http://localhost:7450/anchor.xml',
    })
    expect(esito.sicuro).toBe(true)
  })

  it('blocks when the new feed has another identity', async () => {
    const esito = await confrontaFeed(
      vecchio,
      riassumiFeedPodcast(
        feedNmc((x) =>
          x.replace('2977094a-c6b7-5d6c-9886-e3337ff33d87', '525df898-1954-53ad-90cd-dfb9abbd068f'),
        ),
      ),
      { urlVecchio: URL_ANCHOR },
    )
    expect(esito.sicuro).toBe(false)
    expect(esito.differenze[0]).toMatchObject({ campo: 'podcast:guid', gravita: 'blocca' })
  })

  it('blocks when an old episode is missing under its GUID, as with today’s event ids', async () => {
    const esito = await confrontaFeed(
      vecchio,
      riassumiFeedPodcast(
        feedNmc((x) => x.replace('f666a2ad-c531-4868-ae1a-da55e791fe65', '7c3a91e0b2')),
      ),
      { urlVecchio: URL_ANCHOR },
    )
    expect(esito.sicuro).toBe(false)
    const campi = esito.differenze.map((d) => [d.campo, d.gravita])
    expect(campi).toContainEqual(['episodio-mancante', 'blocca'])
    expect(campi).toContainEqual(['episodio-nuovo', 'avviso'])
  })

  it('warns, without blocking, about a different date, order or title', async () => {
    const esito = await confrontaFeed(
      vecchio,
      riassumiFeedPodcast(
        feedNmc((x) =>
          x
            .replace('Tue, 27 Oct 2026 13:34:42 +0000', 'Thu, 29 Oct 2026 10:00:00 +0000')
            .replace('<title>Brevi articoli test</title>', '<title>Brevi articoli</title>'),
        ),
      ),
      { urlVecchio: URL_ANCHOR },
    )
    expect(esito.sicuro).toBe(true)
    const campi = esito.differenze.map((d) => d.campo)
    expect(campi).toContain('data')
    expect(campi).toContain('titolo')
  })

  it('warns when the new feed has no itunes:new-feed-url', async () => {
    const esito = await confrontaFeed(
      vecchio,
      riassumiFeedPodcast(
        feedNmc((x) => x.replace(/<itunes:new-feed-url>.*<\/itunes:new-feed-url>/, '')),
      ),
      { urlVecchio: URL_ANCHOR },
    )
    expect(esito.differenze.map((d) => d.campo)).toEqual(['new-feed-url'])
  })
})

describe('copying files from the old host', () => {
  const MP3 = new Blob([new Uint8Array([0xff, 0xfb])], { type: 'audio/mpeg' })

  it('downloads an audio file directly when the server allows it', async () => {
    const r = await scaricaFile('https://host.example/a.mp3', TIPO_AUDIO, {
      fetch: async () => new Response(MP3, { status: 200 }),
    })
    expect(r.via).toBe('diretta')
  })

  it('names an audio file as such when the answer is something else', async () => {
    await expect(
      scaricaFile('https://host.example/pagina', TIPO_AUDIO, {
        fetch: async () =>
          new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      }),
    ).rejects.toThrow(/non è un file audio \(text\/html\).*leggerlo/)
  })

  it('asks the Blossom server before uploading, and reads its answer', async () => {
    const risponde =
      (stato: number): typeof fetch =>
      async () =>
        new Response(null, { status: stato })
    const file = { peso: 3_000_000_000, mime: 'audio/mpeg' }
    expect(await accettaUpload('https://b.example', file, { fetch: risponde(200) })).toEqual({
      esito: 'accettato',
    })
    expect(await accettaUpload('https://b.example', file, { fetch: risponde(413) })).toMatchObject({
      esito: 'rifiutato',
      stato: 413,
    })
    expect(await accettaUpload('https://b.example', file, { fetch: risponde(402) })).toMatchObject({
      esito: 'rifiutato',
      stato: 402,
    })
    // The server's own reason, when it gives one, reaches the user.
    const conRagione: typeof fetch = async () =>
      new Response(null, { status: 413, headers: { 'X-Reason': 'massimo 100 MB' } })
    expect(await accettaUpload('https://b.example', file, { fetch: conRagione })).toMatchObject({
      esito: 'rifiutato',
      motivo: expect.stringContaining('«massimo 100 MB»'),
    })
    // A 401 tells nothing about the size: the upload goes ahead.
    expect(await accettaUpload('https://b.example', file, { fetch: risponde(401) })).toMatchObject({
      esito: 'sconosciuto',
      stato: 401,
    })
  })

  it('sends the size and the type it is asking about', async () => {
    let intestazioni: Headers | undefined
    await accettaUpload(
      'https://b.example/',
      { peso: 4376759, mime: 'audio/mp4' },
      {
        fetch: async (url, init) => {
          expect(url).toBe('https://b.example/upload')
          expect(init?.method).toBe('HEAD')
          intestazioni = new Headers(init?.headers)
          return new Response(null, { status: 200 })
        },
      },
    )
    expect(intestazioni?.get('X-Content-Length')).toBe('4376759')
    expect(intestazioni?.get('X-Content-Type')).toBe('audio/mp4')
  })
})
