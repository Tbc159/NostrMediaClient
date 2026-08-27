/**
 * Distanza da adesso, in italiano.
 *
 * `Intl.RelativeTimeFormat` fa il lavoro di traduzione; qui si sceglie solo
 * l'unita' piu' leggibile. Sopra la settimana si passa alla data assoluta:
 * "37 giorni fa" costringe chi legge a fare i conti.
 */
export function tempoRelativo(data: Date, adesso: Date = new Date()): string {
  const secondi = Math.round((data.getTime() - adesso.getTime()) / 1000)
  const assoluti = Math.abs(secondi)

  const fmt = new Intl.RelativeTimeFormat('it-IT', { numeric: 'auto' })

  if (assoluti < 60) return fmt.format(Math.round(secondi), 'second')
  if (assoluti < 3600) return fmt.format(Math.round(secondi / 60), 'minute')
  if (assoluti < 86_400) return fmt.format(Math.round(secondi / 3600), 'hour')
  if (assoluti < 604_800) return fmt.format(Math.round(secondi / 86_400), 'day')

  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(data)
}
