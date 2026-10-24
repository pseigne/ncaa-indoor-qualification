// The event page and the board compare today's line with an earlier saved one. Early January lists are
// tiny (a dozen relays, say), so their "line" is just the slowest mark and makes a poor comparison. Start
// from the first snapshot on or after Feb 1 of the season, and skip any snapshot whose list held no more
// marks than the qualifying spot. With none left, there is nothing honest to compare against. Each
// series point carries `n`, the number of marks in that day's saved list, from the summary data.

export function comparisonStart(year) {
  const end = String(year).split(/[-_]/).at(-1)
  return `${end}-02-01`
}

export function pickComparison(series, { rank, year }) {
  if (!Number.isFinite(rank)) return null
  const from = comparisonStart(year)
  return series.find(point => point.d >= from && Number.isFinite(point.v) && Number.isFinite(point.n) && point.n > rank) || null
}

// The points from the chosen one on, for the sentence and the sparkline.
export function comparisonSeries(series, chosen) {
  return chosen ? series.filter(point => point.d >= chosen.d) : []
}
