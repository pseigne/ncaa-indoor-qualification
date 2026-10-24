import { compareEvents, eventMeta, hasStrip, slugFromLabel } from './catalog'
import { markInfo } from './format'
import { parseTime } from './helpers'
import { readQualification } from './qualification'

// index.json lists every season the site has, by gender and region (outdoor lists are by region).
function scopeRegion(season, region) {
  return season === 'indoor' ? 'National' : region
}

function seasonLists(index, season, gender) {
  return (index?.lists || []).filter(item => item.season === season && item.gender === gender)
}

// Every season with a saved list, newest first.
export function seasonYears(index, season, gender) {
  return [...new Set(seasonLists(index, season, gender).map(item => item.year))].sort().reverse()
}

export function activeYear(index, season, gender) {
  const years = seasonLists(index, season, gender).filter(item => item.current).map(item => item.year).sort()
  return years.at(-1) || null
}

// The file for one season's list, and its saved days.
export function listEntry(index, { season, gender, region, year }) {
  const target = scopeRegion(season, region)
  return seasonLists(index, season, gender).find(item => item.year === year && item.region === target) || null
}

export function historyFile(index, { season, gender }) {
  return index?.history?.[`${season}-${gender}`] || null
}

// The TFRRS list a past season's records came from, named like the current ones.
export function pastList(entry) {
  if (!entry?.source) return null
  const { season, region, year } = entry
  const [start, end] = year.split('-')
  const label = end ? `${start}–${end}` : start
  return {
    href: `https://www.tfrrs.org/lists/${entry.source.list_id}/${entry.source.list_name}`,
    title: `${label} NCAA Division I ${season === 'outdoor' ? `${region} ` : ''}${season} list`,
  }
}

export function listContext(scope) {
  return {
    championship: scope?.championship ?? null,
    listDate: scope?.listDate ?? null,
    final: scope?.final === true,
  }
}

// A saved day's qualifying mark, which is missing when that day's list didn't reach the spot.
function seconds(mark) {
  if (typeof mark !== 'string' || !mark.trim()) return null
  const value = parseTime(mark)
  return Number.isFinite(value) ? value : null
}

export function buildEvents(scope) {
  if (!scope) return []
  const { season } = scope
  const events = (scope.events || []).map(record => {
    const qualification = readQualification(record)
    const meta = eventMeta(record.event)
    const available = qualification.status === 'available' && qualification.entry
    const entry = available ? qualification.entry : null
    const entryMark = entry ? markInfo(entry.time, entry) : null
    const rows = [...(record.rankings || [])]
      .sort((a, b) => a.rank - b.rank)
      .map(row => {
        const mark = markInfo(row.time, row)
        return {
          rank: row.rank,
          athlete: row.athlete || '',
          team: row.team || '',
          v: mark.v,
          alt: mark.alt,
          note: mark.note,
          conversion: mark.conversion,
          raw: mark.raw,
        }
      })
    const series = (record.series || []).map(([d, mark, marks]) => ({
      d, v: seconds(mark), n: Number.isInteger(marks) ? marks : null,
    }))
    const tracked = series.some(point => Number.isFinite(point.v))
    const droppedAfterMeet = !tracked && series.length === 0 && record.afterMeet === true
    return {
      name: record.event,
      label: meta.label,
      slug: slugFromLabel(meta.label),
      kind: meta.kind,
      dist: meta.dist,
      group: meta.group,
      rank: qualification.rank,
      isRelay: qualification.is_relay === true,
      status: available && entryMark?.v != null ? 'available' : 'missing',
      rows,
      line: available && entryMark?.v != null ? {
        rank: entry.rank,
        athlete: entry.athlete || '',
        team: entry.team || '',
        v: entryMark.v,
        alt: entryMark.alt,
        note: entryMark.note,
        conversion: entryMark.conversion,
        raw: entryMark.raw,
      } : null,
      series,
      tracked,
      droppedAfterMeet,
      strip: hasStrip(meta),
    }
  })
  events.sort((a, b) => compareEvents(a, b, season))
  return events
}

export function grouped(events) {
  const groups = []
  for (const event of events) {
    const last = groups.at(-1)
    if (!last || last.name !== event.group) groups.push({ name: event.group, events: [event] })
    else last.events.push(event)
  }
  return groups
}
