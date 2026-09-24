import type { Tag } from './tags.js'
import type { EventTemplate, NostrEvent } from './types.js'

/**
 * Conservare i tag che il client non sa scrivere.
 *
 * Un evento sostituibile si modifica ripubblicandolo: si legge dai relay, si
 * riempie un form, si ricompone. Il guaio e' che **il form diventa l'unica
 * fonte**, e tutto cio' che non ha un campo sparisce. Un evento calendario
 * scritto da un altro client porta `lat`, `lon`, `place_id`, i colori del
 * tema: dati veri, di cui il nostro form non sa nulla e che al primo
 * salvataggio si perderebbero per sempre.
 *
 * Qui non si prova a capirli. Si conservano: quello che non sappiamo scrivere
 * lo ripubblichiamo com'era, e lo si mostra all'utente, che e' l'unico in
 * grado di decidere se ha ancora senso.
 *
 * **Come si distingue cio' che e' nostro.** Non c'e' un elenco di tag
 * dichiarati per kind — sarebbe una lista da tenere allineata a mano, e prima
 * o poi non lo sarebbe piu'. Si guarda invece cosa il kind scrive *per
 * quell'evento*: si ricostruisce il template a partire dall'evento appena
 * letto e si confrontano i **nomi** dei tag. Quelli che il kind non scrive
 * sono aggiuntivi.
 *
 * **Per nome, non per tag intero.** Se l'originale ha tre `p` e il kind ne
 * scrive uno, i `p` sono roba del kind: tenerne due «aggiuntivi» creerebbe
 * partecipanti fantasma che nessuno ha chiesto.
 *
 * **La fotografia si scatta all'apertura.** Se il confronto si rifacesse a
 * ogni ricomposizione, svuotare un campo — togliere l'immagine — toglierebbe
 * `image` dai tag costruiti, e il vecchio `image` rientrerebbe come tag
 * aggiuntivo annullando la modifica. Calcolata una volta sola quando si apre
 * l'evento, la lista resta stabile e l'utente la vede.
 */

/** I nomi dei tag presenti in un template. */
function nomi(tags: readonly Tag[]): Set<string> {
  return new Set(tags.map((t) => t[0] ?? ''))
}

/**
 * I tag dell'evento originale che il kind non scrive.
 *
 * @param originale l'evento come sta sui relay
 * @param costruito il template ricostruito **da quell'evento**, senza modifiche
 */
export function tagAggiuntivi(originale: NostrEvent, costruito: EventTemplate): Tag[] {
  const nostri = nomi(costruito.tags)
  return originale.tags
    .filter((t) => t.length > 0 && !nostri.has(t[0] as string))
    .map((t) => [...t])
}

/** Un tag e' uguale a un altro se lo sono tutti i suoi elementi. */
const stessoTag = (a: Tag, b: Tag): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/**
 * I tag costruiti piu' quelli conservati, in coda.
 *
 * I doppioni esatti si scartano: un tag identico gia' scritto dal kind non va
 * ripetuto. Un tag con lo stesso nome ma valore diverso invece resta — e'
 * lecito in Nostr, ed e' compito della UI avvisare quando non ha senso.
 */
export function fondiTag(costruiti: readonly Tag[], aggiuntivi: readonly Tag[]): Tag[] {
  const risultato: Tag[] = costruiti.map((t) => [...t])
  for (const t of aggiuntivi) {
    if (t.length === 0 || !t[0]) continue
    if (risultato.some((g) => stessoTag(g, t))) continue
    risultato.push([...t])
  }
  return risultato
}
