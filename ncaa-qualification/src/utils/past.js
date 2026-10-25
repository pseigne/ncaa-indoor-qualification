import { formatMark, markConversion, markInfo, ordinal, rawMark } from './format'
import { parseTime } from './helpers'
import { readField } from './qualification'

// One saved qualifying line. A later season is another object, with its own place.
// `comparable` is false for the standards era and for a cancelled season, which
// are stored for the chart but never turned into a gap.
// {
//   lines: [{
//     season, region, gender, event, year, rank, mark, athlete, team,
//     place?, of?, rule?, comparable?, note?, flag?, converted?,
//     conversion?: "flat" | "altitude" | "both" | null,
//     tie?: { rank, athlete, team },
//     field?: { status, rank, size, accepted, cancelled, entry, unmatched }
//   }]
// }

function yearKey(year) {
  return String(year || '').replaceAll('_', '-')
}

// A past season's field as accepted, without the ranks it took in or left out. Malformed reads as none.
function pastField(line) {
  const field = readField(line, { history: true })
  if (!field) return null
  const mark = field.entry ? markInfo(field.entry.time, field.entry) : null
  if (field.status === 'available' && mark?.v == null) return null
  return {
    status: field.status,
    rank: field.rank,
    accepted: field.accepted,
    cancelled: field.cancelled,
    unmatched: field.unmatched,
    mark: field.entry ? field.entry.time.trim() : '',
    v: mark?.v ?? null,
    conversion: mark?.conversion ?? null,
  }
}

function usable(line) {
  if (!line || !Number.isInteger(line.rank) || line.rank < 1) return false
  if (typeof line.mark !== 'string' || !line.mark.trim() || line.mark.trim() === 'N/A') return false
  const seconds = parseTime(line.mark)
  return Number.isFinite(seconds) && seconds > 0
}

export function pastLines(catalog, { season, region, gender, event }) {
  const saved = Array.isArray(catalog?.lines) ? catalog.lines : []
  const wantRegion = season === 'indoor' ? 'National' : region
  return saved
    .filter(line => (
      line.season === season &&
      line.region === wantRegion &&
      line.gender === gender &&
      line.event === event &&
      (line.rule === 'cancelled' || usable(line))
    ))
    .map(line => {
      const comparable = line.comparable !== false && line.rule !== 'standards' && line.rule !== 'cancelled'
      const mark = typeof line.mark === 'string' ? line.mark.trim() : ''
      return {
        season: line.season,
        region: line.region,
        gender: line.gender,
        event: line.event,
        year: yearKey(line.year),
        rank: line.rank,
        place: Number.isInteger(line.place) ? line.place : line.rank,
        of: Number.isInteger(line.of) ? line.of : (comparable ? line.rank : null),
        mark,
        athlete: line.athlete || '',
        team: line.team || '',
        v: usable(line) ? parseTime(mark) : null,
        rule: line.rule || (comparable ? 'line' : 'standards'),
        comparable,
        note: line.note || null,
        flag: line.flag || null,
        converted: line.converted || null,
        conversion: markConversion(mark, line.flag, line.conversion),
        raw: rawMark(line.converted),
        tie: line.tie && Number.isInteger(line.tie.rank) ? line.tie : null,
        field: pastField(line),
      }
    })
    .sort((a, b) => b.year.localeCompare(a.year) || a.rank - b.rank)
}

export function seasonLabel(year) {
  const text = yearKey(year)
  const match = text.match(/^(\d{4})-(\d{4})$/)
  if (!match) return text
  return `${match[1]}\u2013${match[2].slice(2)}`
}

export function yearTick(year) {
  const text = yearKey(year)
  const end = text.includes('-') ? text.split('-')[1] : text
  return `\u2019${end.slice(-2)}`
}

// About five labels, and never more than six. Field steps start at 2 cm so a
// high jump is not labelled at every centimetre.
const TICK_STEPS = {
  mark: [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
  points: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000],
  time: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600],
}

function tickIndex(value, step, direction) {
  const quotient = value / step
  return direction === 'down' ? Math.floor(quotient + 1e-8) : Math.ceil(quotient - 1e-8)
}

function snapBounds(min, max, step) {
  let start = tickIndex(min, step, 'down')
  let end = tickIndex(max, step, 'up')
  if (end < start) end = start
  // A single shared tick has no inside. Step out once on each end.
  if (end === start) {
    start -= 1
    end += 1
  }
  return { start, end, count: end - start + 1 }
}

export function yearScale(values, kind) {
  const finite = values.filter(value => Number.isFinite(value))
  if (!finite.length) return { ticks: [], lo: 0, hi: 1, step: 1 }
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const steps = TICK_STEPS[kind] || TICK_STEPS.time
  let chosen = steps[steps.length - 1]
  let best = Infinity
  for (const step of steps) {
    const { count } = snapBounds(min, max, step)
    if (count < 2 || count > 6) continue
    const score = Math.abs(count - 5) + step / 1e6
    if (score < best) {
      best = score
      chosen = step
    }
  }
  if (!Number.isFinite(best)) {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (snapBounds(min, max, steps[index]).count <= 6) {
        chosen = steps[index]
        break
      }
    }
  }
  const { start, end } = snapBounds(min, max, chosen)
  const ticks = []
  for (let index = start; index <= end; index += 1) {
    const value = kind === 'points' ? Math.round(index * chosen) : Number((index * chosen).toFixed(4))
    ticks.push(value)
  }
  return { ticks, lo: ticks[0], hi: ticks[ticks.length - 1], step: chosen }
}

export function comparedWord(kind, improved) {
  if (kind === 'time') return improved ? 'faster' : 'slower'
  if (kind === 'mark') return improved ? 'higher' : 'lower'
  return improved ? 'better' : 'worse'
}

function placeWord(place, kind) {
  const word = kind === 'time' ? 'fastest' : 'best'
  if (place === 1) return word
  const names = [null, null, 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
  return `${names[place] || ordinal(place)}-${word}`
}

export function pastSummary(lines, kind, currentYear) {
  const comparable = lines.filter(line => line.comparable && Number.isFinite(line.v))
  if (comparable.length < 2) return null
  const current = comparable.find(line => line.year === currentYear) || comparable[0]
  const better = (a, b) => (kind === 'time' ? a.v - b.v : b.v - a.v)
  const ranked = [...comparable].sort(better)
  const place = ranked.findIndex(line => line.year === current.year && line.rank === current.rank) + 1
  const earliest = [...comparable].sort((a, b) => a.year.localeCompare(b.year))[0]
  const field = current.of || current.rank
  const phrase = placeWord(place, kind)
  let change = null
  if (earliest.year !== current.year) {
    const delta = current.v - earliest.v
    const improved = kind === 'time' ? delta < 0 : delta > 0
    if (Math.abs(delta) >= (kind === 'points' ? 0.5 : 1e-9)) {
      const amount = kind === 'time' ? `${Math.abs(delta).toFixed(2)}s` : formatMark(Math.abs(delta), kind)
      change = { amount, word: comparedWord(kind, improved), year: seasonLabel(earliest.year) }
    }
  }
  const best = ranked[0]
  const bestWord = kind === 'time' ? 'fastest' : 'best'
  return { phrase, count: comparable.length, field, change, best: place === 1 ? null : best, bestWord, currentIsNow: current.year === currentYear }
}

