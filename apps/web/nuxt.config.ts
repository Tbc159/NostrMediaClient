import tailwindcss from '@tailwindcss/vite'

/*
 * The publication's base path.
 *
 * On GitHub Pages the site lives in a subfolder, and it is needed here
 * already — not at runtime — because the icon has to be in the **generated**
 * HTML: the browser asks for the favicon before the JavaScript starts, and a
 * `useHead` would arrive too late, leaving a 404 on every load.
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
    // Tailwind 4 integrates with the Vite plugin, not with @nuxtjs/tailwindcss:
    // that module still supports 3.4 alone. The theme's configuration lives in
    // CSS, in assets/css/main.css, through @theme.
    plugins: [tailwindcss()],
  },

  typescript: {
    typeCheck: false, // demandato a `pnpm typecheck`, non al dev server
    strict: true,
  },

  /**
   * A security rule (section 4 of the plan): SSR covers public data alone.
   * The personal feed, the DMs and the settings stay client-only, because the
   * SSR payload is serialised inside the HTML and must never contain identity
   * material.
   */
  routeRules: {
    '/': { ssr: false },
    '/messages/**': { ssr: false },
    '/settings/**': { ssr: false },
    // The diagnostics opens WebSockets to the relays: it has to be client-only.
    '/diagnostica': { ssr: false },
    // Composing and the settings touch identities and keys: never in SSR,
    // where the state would end up serialised in the HTML payload.
    '/impostazioni': { ssr: false },
    '/scrivi': { ssr: false },
    '/calendario/**': { ssr: false },
    // Media and articles read from the relays and upload to Blossom: all client.
    // Both forms are needed: `/**` does not cover the route with no segments.
    '/media': { ssr: false },
    '/media/**': { ssr: false },
    '/articoli': { ssr: false },
    '/articoli/**': { ssr: false },
    '/calendario': { ssr: false },
    '/profilo': { ssr: false },
    /*
     * The public routes: SSR on, for the Open Graph previews.
     *
     * On a static host — GitHub Pages — SSR does not exist and these rules
     * have no effect: link previews require a Node host. The static build is
     * complete all the same, because everything else is client-only already by
     * a security choice.
     */
    '/a/**': { ssr: true },
    '/e/**': { ssr: true },
    '/p/**': { ssr: true },
  },

  runtimeConfig: {
    public: {
      /*
       * Populated from the NUXT_PUBLIC_* variables — see .env.example.
       *
       * The values here are **first-run defaults on public endpoints**, not
       * design choices: they are there to get the client started without a
       * `.env`, which is the case of whoever tries it freshly cloned and of a
       * published static build. They all stay replaceable from the settings.
       *
       * The relay for the drafts stays **deliberately empty**: a public
       * default there would mean sending the drafts of whoever has configured
       * nothing to somebody else's relay.
       */
      defaultReadRelays: 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net',
      defaultWriteRelays: 'wss://nos.lol,wss://relay.primal.net',
      indexerRelays: 'wss://purplepag.es,wss://user.kindpag.es',
      draftRelay: '',
      defaultBlossomServers: 'https://blossom.yakihonne.com,https://nostr.download',
      siteUrl: 'http://localhost:3000',
      njumpUrl: 'https://njump.me',

      /*
       * The processing service (the Audio section).
       *
       * The archive and the audio processing are domains of the same
       * microservice. The address here is the one **working today**, because a
       * section that opens by asking for an address is of no use to whoever
       * does not know it. It stays replaceable from the settings.
       *
       * The key stays **deliberately empty**: it is a credential, and the
       * `public` values end up in the bundle served to the browser. Whoever
       * develops puts it in their own `.env`; a public build, which does not
       * have that `.env`, starts without a key and says so in the settings.
       */
      mediaManagerUrl: 'https://mediamanager-dev.duckdns.org',
      mediaManagerApiKey: '',

      /*
       * The feed's stable address on a domain NMC manages: the CNAME mode and
       * the managed subdomains. Both wait for the NMC domain, so they are off:
       * the interface shows them as «coming soon» and lets them be tried in a
       * simulation that calls nothing, signs nothing and saves nothing. The
       * operator turns them on after buying the domain — and even then they
       * work only if the service declares them in its capabilities.
       */
      feedDominiGestiti: false,
      /** Where the managed subdomains live: `<name>.<suffix>`. A placeholder until the NMC domain. */
      feedSubdomainSuffix: 'duckdns.org',
    },
  },
})
