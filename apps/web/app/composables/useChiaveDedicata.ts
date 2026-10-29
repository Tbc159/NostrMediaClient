import {
  authoredPodcastsDefinition,
  encryptSecretKey,
  fondiTag,
  metadataDefinition,
  newSecretKey,
  plainEventTemplate,
  publicKeyFrom,
  relayListDefinition,
  signWithSecretKey,
  toNpub,
  toNsec,
  wipeSecretKey,
  type Firmatario,
  type SecretKey,
} from '@nmc/nostr-core'

/**
 * Creating a key for a podcast of its own, without leaving the personal one.
 *
 * NIP-F4 makes every podcast a key. Putting a show on the personal identity is
 * the simple road, but it leaves room for one podcast only, and ties the show to
 * the person for ever. A dedicated key separates them, at the cost of one more
 * secret to keep safe — which is why the steps are in this order:
 *
 *   1. the key is born, encrypted with a password, and its nsec is shown once
 *      with a backup to download: nothing is published until the user says it
 *      is safe;
 *   2. the **personal** key, still the active one, publishes its 10064 naming
 *      the new key: the half of the link only the author can write;
 *   3. the **new** key signs its own profile (kind 0) and relay list (kind
 *      10002) through a signer that lives as long as this composable — the
 *      service that builds the feed finds a key through its 10002, and a key
 *      born a minute ago has none;
 *   4. only then does the active identity switch to the new key, which stays in
 *      the saved identities, encrypted, next to the personal one.
 *
 * The show's card (10154) is left to whoever called this: the import or the
 * profile page publish it on the new key, naming the personal one as `host`.
 */

/** The answer to «which key does the podcast live on». */
export type SceltaChiave = 'questa' | 'dedicata'

export interface ChiaveCreata {
  pubkey: string
  npub: string
  /** Shown once, then dropped from the state. */
  nsec: string | null
  /** The NIP-49 backup: safe to download, useless without the password. */
  ncryptsec: string
}

export interface DatiShow {
  titolo: string
  immagine?: string
  descrizione?: string
}

/** «Storie di Bitcoin» → «storie-di-bitcoin»: a profile's short name has no spaces. */
const nomeBreve = (titolo: string): string =>
  titolo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'podcast'

export function useChiaveDedicata() {
  const identita = useIdentity()
  const config = useClientConfig()
  const invio = usePublish()
  const esistente = useEventoEsistente()

  /** The secret, outside any reactive state: never serialised, wiped when done. */
  let segreta: SecretKey | null = null
  let password: string | null = null

  const creata = ref<ChiaveCreata | null>(null)
  const messaAlSicuro = ref(false)
  const errore = ref<string | null>(null)
  const fase = ref<string | null>(null)
  /** The personal key the new one was created from: the show's `host`. */
  const autore = ref<string | null>(null)
  const completata = ref(false)

  function genera(nuovaPassword: string): void {
    errore.value = null
    scarta()
    segreta = newSecretKey()
    password = nuovaPassword
    const pubkey = publicKeyFrom(segreta)
    creata.value = {
      pubkey,
      npub: toNpub(pubkey),
      nsec: toNsec(segreta),
      ncryptsec: encryptSecretKey(segreta, nuovaPassword),
    }
    messaAlSicuro.value = false
  }

  /** The backup as a text file: the encrypted key, the npub, and how to use them. */
  function backup(titolo: string): { nome: string; contenuto: string } | null {
    const c = creata.value
    if (!c) return null
    const nome = `${nomeBreve(titolo)}-chiave.txt`
    const contenuto = [
      `Chiave del podcast «${titolo.trim()}»`,
      '',
      `Chiave pubblica (npub): ${c.npub}`,
      `Chiave privata cifrata (NIP-49, ncryptsec): ${c.ncryptsec}`,
      '',
      'La chiave cifrata si apre solo con la password scelta alla creazione.',
      'Per accedere: NostrMediaClient → Impostazioni → Chiave privata, incolla la ncryptsec,',
      'oppure importala in un’estensione che legge NIP-49.',
      '',
    ].join('\n')
    return { nome, contenuto }
  }

  const firmatarioNuovo = (): Firmatario => {
    const sk = segreta
    const pk = creata.value?.pubkey
    if (!sk || !pk) throw new Error('La chiave dedicata non è più in memoria: creane una nuova.')
    return {
      pubkey: async () => pk,
      firma: async (template) => signWithSecretKey(plainEventTemplate(template), sk),
    }
  }

  /** Publishes the personal 10064, keeping the podcasts already listed and other clients' tags. */
  async function dichiaraAutore(podcast: string): Promise<void> {
    const precedente = await esistente.perCoordinata(10064)
    const elencati = precedente ? authoredPodcastsDefinition.parse(precedente).podcasts : []
    const costruito = authoredPodcastsDefinition.build(
      { podcasts: [...elencati, podcast] },
      { pubkey: identita.pubkey ?? '', now: Math.floor(Date.now() / 1000) },
    )
    const altri = (precedente?.tags ?? []).filter((t) => t[0] !== 'p' && t[0] !== 'client')
    const firmato = await identita.firma({ ...costruito, tags: fondiTag(costruito.tags, altri) })
    if (!(await invio.pubblica(firmato))) {
      throw new Error(
        `La dichiarazione di autore (kind 10064) non è stata accettata: ${invio.errore.value ?? 'nessun relay l’ha presa'}.`,
      )
    }
  }

  async function pubblicaComeNuova(template: Parameters<Firmatario['firma']>[0], cosa: string) {
    const firmato = await firmatarioNuovo().firma(template)
    if (!(await invio.pubblica(firmato))) {
      throw new Error(
        `${cosa} della nuova chiave non è stato accettato: ${invio.errore.value ?? 'nessun relay l’ha preso'}.`,
      )
    }
  }

  /**
   * Steps 2–4: the declarations, then the switch to the new key.
   *
   * Each step that succeeds stays published; a failure stops before the switch,
   * so the user is still on the personal key and can try again.
   */
  async function attiva(show: DatiShow): Promise<boolean> {
    const c = creata.value
    if (!c || !segreta || !password) {
      errore.value = 'Crea prima la chiave.'
      return false
    }
    if (!messaAlSicuro.value) {
      errore.value =
        'Conferma di aver messo al sicuro la chiave: senza una copia, il podcast è perso.'
      return false
    }
    if (!identita.puoFirmare || !identita.pubkey) {
      errore.value =
        identita.motivoNonFirmabile ??
        'Serve la tua identità personale, sbloccata: è lei a dichiararsi autrice del podcast.'
      return false
    }
    errore.value = null
    const personale = identita.pubkey
    const now = () => Math.floor(Date.now() / 1000)
    try {
      fase.value = 'La tua chiave dichiara di essere autrice del podcast (kind 10064)…'
      await dichiaraAutore(c.pubkey)

      fase.value = 'La nuova chiave pubblica il suo profilo (kind 0)…'
      await pubblicaComeNuova(
        metadataDefinition.build(
          {
            // `name` is the username-like one, `display_name` the title as written.
            name: nomeBreve(show.titolo),
            display_name: show.titolo.trim(),
            ...(show.immagine?.trim() ? { picture: show.immagine.trim() } : {}),
            ...(show.descrizione?.trim() ? { about: show.descrizione.trim() } : {}),
          },
          { pubkey: c.pubkey, now: now() },
        ),
        'Il profilo',
      )

      fase.value = 'La nuova chiave pubblica i suoi relay (kind 10002)…'
      const cfg = config.value
      const relay = [...new Set([...cfg.readRelays, ...cfg.writeRelays])].map((url) => ({
        url,
        lettura: cfg.readRelays.includes(url),
        scrittura: cfg.writeRelays.includes(url),
      }))
      await pubblicaComeNuova(
        relayListDefinition.build({ relays: relay }, { pubkey: c.pubkey, now: now() }),
        'L’elenco dei relay',
      )

      fase.value = 'Passo alla nuova chiave…'
      identita.accediConChiave(toNsec(segreta), password, show.titolo.trim())
      autore.value = personale
      completata.value = true
      return true
    } catch (e) {
      errore.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      fase.value = null
      if (completata.value) chiudi()
    }
  }

  /** Drops the nsec from the page once it has been saved. */
  function nascondiNsec(): void {
    if (creata.value) creata.value = { ...creata.value, nsec: null }
  }

  /** Forgets the secret and the password; the encrypted copy is in the saved identities. */
  function chiudi(): void {
    if (segreta) wipeSecretKey(segreta)
    segreta = null
    password = null
    nascondiNsec()
  }

  /** Throws away a key that was never activated. */
  function scarta(): void {
    chiudi()
    creata.value = null
    messaAlSicuro.value = false
    completata.value = false
  }

  onScopeDispose(chiudi)

  return {
    creata,
    messaAlSicuro,
    errore,
    fase,
    autore,
    completata,
    genera,
    backup,
    nascondiNsec,
    attiva,
    scarta,
  }
}
