/**
 * The distance from now, in Italian.
 *
 * `Intl.RelativeTimeFormat` does the translating; here only the most readable
 * unit is chosen. Above a week it switches to the absolute date: "37 days ago"
 * forces the reader to do the arithmetic.
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
