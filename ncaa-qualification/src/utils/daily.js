// The season dialog's race: each saved day's top 20 as [mark, athlete], stored only on the days it
// changed. A day with no change is the last one stored.

// [seconds or metres, family name, altitude flag, flat-track flag], or null for a mark with no value.
export function parseDailyMark(raw) {
  const text = String(raw)
  const alt = text.includes('@') ? 1 : 0
  const note = text.includes('#') ? 1 : 0
  const cleaned = text.replace(/\(.*?\)/g, '').replace(/[@#]/g, '').trim()
  if (!cleaned || cleaned === 'N/A') return null
  let value
  if (cleaned.includes(':')) {
    const [minutes, seconds] = cleaned.split(':')
    value = Number(minutes) * 60 + Number(seconds)
  } else value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return null
  return [Math.round(value * 100) / 100, alt, note]
}

function dayRows(top) {
  const rows = []
  for (const [raw, name] of top) {
    const mark = parseDailyMark(raw)
    if (!mark) continue
    const athlete = String(name || '')
    const family = athlete && athlete !== 'N/A' ? athlete.split(', ')[0].replace(/'/g, '’') : ''
    rows.push([mark[0], family, mark[1], mark[2]])
  }
  return rows
}

// Every saved day of the event's chart that its race can show: [{ d, r: [[v, family, alt, note]] }].
export function dailyDays(daily, event) {
  if (!daily || !event.strip || !event.line) return []
  const changes = (daily[event.name] || []).map(([d, top]) => ({ d, r: dayRows(top) }))
  const days = []
  let index = -1
  for (const point of event.series) {
    while (index + 1 < changes.length && changes[index + 1].d <= point.d) index += 1
    if (index >= 0) days.push({ d: point.d, r: changes[index].r })
  }
  return days.filter(day => day.r.length >= event.line.rank && Number.isFinite(day.r[event.line.rank - 1]?.[0]))
}
