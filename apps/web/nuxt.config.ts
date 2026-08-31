import tailwindcss from '@tailwindcss/vite'

/*
 * Percorso di base della pubblicazione.
 *
 * Su GitHub Pages il sito vive in una sottocartella, e serve gia' qui — non a
 * runtime — perche' l'icona deve stare nell'HTML **generato**: il browser
 * chiede la favicon prima che il JavaScript parta, e un `useHead` arriverebbe
 * troppo tardi, lasciando un 404 a ogni caricamento.
 */
const base = process.env.NUXT_APP_BASE_URL ?? '/'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-08-24',
  devtools: { enabled: true },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg`.replace(/\/{2,}/g, '/') },
      ],
    },
  },

  modules: ['@pinia/nuxt'],

  css: ['~/assets/css/main.css'],

  vite: {
    // Tailwind 4 si integra con il plugin Vite, non con @nuxtjs/tailwindcss:
    // quel modulo supporta ancora solo la 3.4. La configurazione del tema
    // vive in CSS, in assets/css/main.css, tramite @theme.
    plugins: [tailwindcss()],
  },

  typescript: {
    typeCheck: false, // demandato a `pnpm typecheck`, non al dev server
    strict: true,
  },

  /**
   * Regola di sicurezza (sezione 4 del piano): l'SSR copre solo dati pubblici.
   * Feed personale, DM e impostazioni restano client-only, perche' il payload
   * SSR viene serializzato dentro l'HTML e non deve mai contenere materiale
   * di identita'.
   */
  routeRules: {
    '/': { ssr: false },
    '/messages/**': { ssr: false },
    '/settings/**': { ssr: false },
    // La diagnostica apre WebSocket verso i relay: e' per forza client-only.
    '/diagnostica': { ssr: false },
    // Composizione e impostazioni toccano identita' e chiavi: mai in SSR,
    // dove lo stato finirebbe serializzato nel payload HTML.
    '/impostazioni': { ssr: false },
    '/scrivi': { ssr: false },
    '/calendario/**': { ssr: false },
    // Media e articoli leggono dai relay e caricano su Blossom: tutto client.
    // Le due forme servono entrambe: `/**` non copre la rotta senza segmenti.
    '/media': { ssr: false },
    '/media/**': { ssr: false },
    '/articoli': { ssr: false },
    '/articoli/**': { ssr: false },
    '/calendario': { ssr: false },
    '/profilo': { ssr: false },
    /*
     * Route pubbliche: SSR attivo per le anteprime Open Graph.
     *
     * Su un host statico — GitHub Pages — l'SSR non esiste e queste regole non
     * hanno effetto: le anteprime dei link richiedono un host Node. La build
     * statica resta comunque completa, perche' tutto il resto e' gia'
     * client-only per scelta di sicurezza.
     */
    '/a/**': { ssr: true },
    '/e/**': { ssr: true },
    '/p/**': { ssr: true },
  },

  runtimeConfig: {
    public: {
      /*
       * Popolate dalle variabili NUXT_PUBLIC_* — vedi .env.example.
       *
       * I valori qui sono **default di primo avvio su endpoint pubblici**, non
       * scelte di progetto: servono a far partire il client senza `.env`, che
       * e' il caso di chi lo prova appena clonato e di una build statica
       * pubblicata. Restano tutti sostituibili dalle impostazioni.
       *
       * Il relay per le bozze resta **vuoto di proposito**: un default pubblico
       * la' significherebbe mandare le bozze di chi non ha configurato nulla su
       * un relay altrui.
       */
      defaultReadRelays: 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net',
      defaultWriteRelays: 'wss://nos.lol,wss://relay.primal.net',
      indexerRelays: 'wss://purplepag.es,wss://user.kindpag.es',
      draftRelay: '',
      defaultBlossomServers: 'https://blossom.yakihonne.com,https://nostr.download',
      siteUrl: 'http://localhost:3000',
      njumpUrl: 'https://njump.me',
    },
  },
})
