import { compareEvents, eventMeta, slugFromLabel } from './catalog'
import { formatBare, MINUS } from './format'
import { parseTime } from './helpers'

// The national meet, outdoors: the 24 who went on from the two First Rounds in each event, and how they
// finished. Python joins the qualifier lists to region and results; the site only reads the file.

export const REGIONS = ['East', 'West']
const PLACES = new Set([...REGIONS, 'National'])
const ROUNDS = ['final', 'semifinal', 'prelim']
const STATUSES = new Set(['DNS', 'DNF', 'DQ', 'NM', 'NH', 'FS'])

// The national meets index.json lists for one gender, newest first. An entry that isn't an outdoor
// year with a nationals file is left out, so a bad one never reaches the page.
export function nationalsEntries(index, gender) {
  const list = Array.isArray(index?.nationals) ? index.nationals : []
  const seen = new Set()
  return list
    .filter(item => item && item.season === 'outdoor' && item.gender === gender
      && /^\d{4}$/.test(item.year ?? '') && isNationalsFile(item.file))
    .filter(item => !seen.has(item.year) && seen.add(item.year))
    .map(item => ({ year: item.year, file: item.file }))
    .sort((a, b) => b.year.localeCompare(a.year))
}

export function isNationalsFile(name) {
  return typeof name === 'string' && /^nationals-[\w-]+\.json$/.test(name)
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function whole(value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

function link(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null
}

function firstRound(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    place: whole(raw.place),
    mark: text(raw.mark),
    wind: text(raw.wind),
    q: raw.q === 'Q' || raw.q === 'q' ? raw.q : null,
  }
}

function result(raw) {
  if (!raw || typeof raw !== 'object') return null
  const round = ROUNDS.includes(raw.round) ? raw.round : null
  return {
    // A place is a final place: anyone out before the final has none.
    place: round === 'final' || round === null ? whole(raw.place) : null,
    round,
    mark: text(raw.mark),
    wind: text(raw.wind),
    status: STATUSES.has(raw.status) ? raw.status : null,
    points: Number.isFinite(raw.points) && raw.points > 0 ? raw.points : null,
  }
}

function qualifier(raw) {
  if (!raw || typeof raw !== 'object') return null
  const athlete = text(raw.athlete)
  if (!athlete) return null
  return {
    athlete,
    team: text(raw.team) || '',
    region: PLACES.has(raw.region) ? raw.region : null,
    listRank: whole(raw.listRank),
    seed: text(raw.seed),
    firstRound: firstRound(raw.firstRound),
    nationals: result(raw.nationals),
  }
}

// The site file as the page reads it, or null when it isn't one. Events and qualifiers that are not
// what the contract says are dropped one by one; a file that is not a national meet at all is refused.
export function readNationals(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  if (json.season !== 'outdoor' || !/^\d{4}$/.test(json.year ?? '') || !['m', 'f'].includes(json.gender)) return null
  if (!Array.isArray(json.events)) return null
  const meet = json.meet && typeof json.meet === 'object' ? json.meet : {}
  const date = text(meet.start_date)
  return {
    season: 'outdoor',
    year: json.year,
    gender: json.gender,
    meet: { name: text(meet.name), start_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null },
    sources: (Array.isArray(json.sources) ? json.sources : [])
      .map(source => ({ label: text(source?.label), url: link(source?.url) }))
      .filter(source => source.label && source.url),
    events: json.events
      .filter(item => text(item?.event) && Array.isArray(item.qualifiers))
      .map(item => ({ event: text(item.event), qualifiers: item.qualifiers.map(qualifier).filter(Boolean) })),
  }
}

// A mark as a number, for ordering; null when it isn't one (a status, an empty seed).
export function markValue(mark) {
  if (typeof mark !== 'string' || !mark.trim()) return null
  const value = parseTime(mark.replace(/[a-zA-Z]+$/, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

// A mark the way the heat sheet writes it; text that isn't a mark is shown as it came.
export function markText(mark, kind) {
  const value = markValue(mark)
  if (value == null) return mark || ''
  return formatBare(value, kind)
}

export function windText(wind) {
  return wind ? wind.replace(/^-/, MINUS) : ''
}

// Finalists by place, then those out in the semifinal, then the prelims, then anyone who didn't start,
// finish or mark. Before results there is no place, so everyone is in seed order.
function band(q) {
  const n = q.nationals
  if (!n) return 4
  if (n.status) return 3
  if (n.place) return 0
  return n.round === 'semifinal' ? 1 : n.round === 'prelim' ? 2 : n.round === 'final' ? 0 : 3
}

function depth(q) {
  const round = q.nationals?.round
  return round ? ROUNDS.indexOf(round) : ROUNDS.length
}

export function orderQualifiers(qualifiers, kind) {
  const better = kind === 'time' ? 1 : -1
  const seed = q => markValue(q.seed)
  return qualifiers
    .map((q, at) => ({ q, at }))
    .sort((a, b) => {
      const ba = band(a.q)
      const bb = band(b.q)
      if (ba !== bb) return ba - bb
      if (ba === 0) {
        const pa = a.q.nationals.place ?? Infinity
        const pb = b.q.nationals.place ?? Infinity
        if (pa !== pb) return pa - pb
      }
      if (ba === 3 && depth(a.q) !== depth(b.q)) return depth(a.q) - depth(b.q)
      const sa = seed(a.q)
      const sb = seed(b.q)
      if (sa !== sb) {
        if (sa == null) return 1
        if (sb == null) return -1
        return (sa - sb) * better
      }
      return a.at - b.at
    })
    .map(item => item.q)
}

// Where the rows break on the heat sheet: the final, each earlier round, and those with no result.
export function rowGroup(q) {
  const b = band(q)
  return ['final', 'semifinal', 'prelim', 'none', 'pending'][b]
}

// Totals by region; `weight` is 1 for each one counted, or the points they scored.
function count(qualifiers, weight) {
  const totals = { East: 0, West: 0, National: 0 }
  for (const q of qualifiers) {
    if (q.region) totals[q.region] += weight(q)
  }
  return totals
}

// East against West: who went, who made the final, the top 8 (the scoring places, and the first-team
// All-Americans), and the team points they scored. A part is null when the file can't say it yet.
export function regionSummary(qualifiers) {
  const results = qualifiers.some(q => q.nationals)
  const rounds = qualifiers.some(q => q.nationals?.round && q.nationals.round !== 'final')
  const placed = qualifiers.some(q => q.nationals?.place)
  const scored = qualifiers.some(q => q.nationals?.points)
  return {
    qualifiers: count(qualifiers, () => 1),
    total: qualifiers.length,
    final: rounds ? count(qualifiers, q => (q.nationals?.round === 'final' ? 1 : 0)) : null,
    top8: placed ? count(qualifiers, q => ((q.nationals?.place ?? Infinity) <= 8 ? 1 : 0)) : null,
    points: scored ? count(qualifiers, q => q.nationals?.points || 0) : null,
    results,
  }
}

function points(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

// The summary strip's parts, as label and words: "Final", "5 East, 4 West".
export function summaryParts(summary, multi = false) {
  const split = totals => REGIONS.map(region => `${totals[region]} ${region}`).join(', ')
  if (multi) return [{ label: 'Qualifiers', words: `${summary.total} from the national list` }]
  const parts = [{ label: 'Qualifiers', words: split(summary.qualifiers) }]
  if (summary.final) parts.push({ label: 'Final', words: split(summary.final) })
  if (summary.top8) parts.push({ label: 'Top 8', words: split(summary.top8) })
  if (summary.points) {
    parts.push({ label: 'Points', words: REGIONS.map(region => `${points(summary.points[region])} ${region}`).join(', ') })
  }
  return parts
}

// Each event in meet order, with its qualifiers in final order and the East against West count.
export function nationalsEvents(data) {
  if (!data) return []
  const events = data.events.map(item => {
    const meta = eventMeta(item.event)
    const qualifiers = orderQualifiers(item.qualifiers, meta.kind)
    return {
      name: item.event,
      label: meta.label,
      slug: slugFromLabel(meta.label),
      kind: meta.kind,
      group: meta.group,
      isRelay: meta.group === 'Relays',
      multi: meta.kind === 'points',
      qualifiers,
      summary: regionSummary(qualifiers),
    }
  })
  events.sort((a, b) => compareEvents(a, b, 'outdoor'))
  return events
}

// One event at nationals, matched to a regional event by its label, or null when the meet has none.
export function nationalsEvent(data, eventName) {
  const slug = slugFromLabel(eventMeta(eventName).label)
  return nationalsEvents(readNationals(data)).find(event => event.slug === slug) || null
}

// How one First Round's qualifiers in an event did at nationals, for the regional event page: how many
// went, the best final place among them, and their ranks on the region's list. The decathlon and
// heptathlon go from the national list, so for them it is the whole field, with no places to tag. Null
// when the file has no such event.
export function wentOn(data, eventName, region) {
  const read = readNationals(data)
  if (!read || !REGIONS.includes(region)) return null
  const slug = slugFromLabel(eventMeta(eventName).label)
  const item = read.events.find(entry => slugFromLabel(eventMeta(entry.event).label) === slug)
  if (!item) return null
  const multi = eventMeta(item.event).kind === 'points'
  const mine = multi ? item.qualifiers : item.qualifiers.filter(q => q.region === region)
  const places = mine.map(q => (q.nationals?.status ? null : q.nationals?.place)).filter(Boolean)
  return {
    slug,
    multi,
    count: mine.length,
    best: places.length ? Math.min(...places) : null,
    results: item.qualifiers.some(q => q.nationals),
    listRanks: multi ? [] : mine.map(q => q.listRank).filter(Boolean).sort((a, b) => a - b),
  }
}
