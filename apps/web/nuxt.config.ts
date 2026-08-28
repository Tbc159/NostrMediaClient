import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-08-24',
  devtools: { enabled: true },

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
    // Route pubbliche: SSR attivo per le anteprime Open Graph.
    '/a/**': { ssr: true },
    '/e/**': { ssr: true },
    '/p/**': { ssr: true },
  },

  runtimeConfig: {
    public: {
      // Popolate dalle variabili NUXT_PUBLIC_* — vedi .env.example.
      // I valori qui sono solo i fallback di sviluppo.
      defaultReadRelays: '',
      defaultWriteRelays: '',
      indexerRelays: '',
      draftRelay: '',
      defaultBlossomServers: '',
      siteUrl: 'http://localhost:3000',
      njumpUrl: 'https://njump.me',
    },
  },
})
