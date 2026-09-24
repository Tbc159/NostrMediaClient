import { tagAggiuntivi, type AnyKindDefinition, type NostrEvent, type Tag } from '@nmc/nostr-core'

/**
 * I tag di un evento pubblicato che il form non sa scrivere.
 *
 * Riaprire un evento per modificarlo significa ricomporlo dal form, e il form
 * conosce solo i suoi campi: tutto il resto — le coordinate geografiche di
 * Plektos, i colori del tema, un tag inventato da un client che non abbiamo
 * mai visto — sparirebbe nel momento in cui si cambia il titolo. Qui si
 * mettono da parte e tornano nell'evento ripubblicato.
 *
 * **La fotografia si scatta una volta sola**, all'apertura: si ricostruisce il
 * template dai dati appena letti e si guarda quali nomi di tag il kind
 * scrive. Ricalcolarla a ogni ricomposizione farebbe rientrare dalla finestra
 * i campi che l'utente ha appena svuotato — tolta l'immagine dal form,
 * `image` non sarebbe piu' fra i tag costruiti e il vecchio valore tornerebbe
 * buono come «tag da conservare».
 */
export function useTagConservati(nomiDelForm: MaybeRefOrGetter<readonly string[]>) {
  const tags = ref<Tag[]>([])

  /**
   * Scatta la fotografia sull'evento appena letto.
   *
   * @param input i dati che il form produrrebbe **senza modifiche**, cioe' la
   *              ricostruzione fedele di cio' che si e' letto.
   */
  function fotografa(definizione: AnyKindDefinition, evento: NostrEvent, input: unknown): void {
    try {
      const comeEra = definizione.build(input, { pubkey: evento.pubkey, now: evento.created_at })
      tags.value = tagAggiuntivi(evento, comeEra)
    } catch {
      // La ricostruzione puo' fallire su un evento che il kind considera
      // malformato (una fine prima dell'inizio, un fuso inesistente): e'
      // proprio il caso in cui conservare conta di piu', perche' l'utente e'
      // qui per correggerlo. Si ripiega sui nomi che il form dichiara di
      // scrivere — meno preciso, ma non perde nulla.
      const nostri = new Set(toValue(nomiDelForm))
      tags.value = evento.tags
        .filter((t) => t.length > 0 && !nostri.has(t[0] as string))
        .map((t) => [...t])
    }
  }

  const azzera = (): void => {
    tags.value = []
  }

  return { tags, fotografa, azzera }
}
