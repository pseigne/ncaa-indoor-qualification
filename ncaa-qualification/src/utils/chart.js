import { parseDay } from './format'

// Stepped path on real dates. Null marks break the line instead of being bridged.
// invert false puts smaller values at the top (faster times). invert true puts larger marks at the top.
export function stepPath(series, x0, x1, y0, y1, dStart, dEnd, vMin, vMax, invert) {
  const span = Math.max(vMax - vMin, 1e-9)
  const tx = d => x0 + (parseDay(d) - parseDay(dStart)) / (parseDay(dEnd) - parseDay(dStart)) * (x1 - x0)
  const ty = v => invert
    ? y0 + (vMax - v) / span * (y1 - y0)
    : y1 - (vMax - v) / span * (y1 - y0)
  const parts = []
  let path = ''
  let open = false
  let prevY = null
  series.forEach(point => {
    if (!Number.isFinite(point.v)) {
      if (open) {
        path += `H${tx(point.d).toFixed(1)}`
        parts.push(path)
        path = ''
        open = false
        prevY = null
      }
      return
    }
    const x = tx(point.d).toFixed(1)
    const y = ty(point.v).toFixed(1)
    if (!open) path = `M${x},${y}`
    else {
      path += `H${x}`
      if (y !== prevY) path += `V${y}`
    }
    open = true
    prevY = y
  })
  if (open) {
    path += `H${tx(dEnd).toFixed(1)}`
    parts.push(path)
  }
  return { d: parts.join(' '), tx, ty }
}

export function finitePoints(series) {
  return series.filter(point => Number.isFinite(point.v))
}

export function axisDates(start, end, phone) {
  const dates = []
  const cursor = parseDay(start)
  const last = parseDay(end)
  while (cursor <= last) {
    const iso = cursor.toISOString().slice(0, 10)
    if (iso !== end && (iso === start || cursor.getDate() === 1 || cursor.getDate() === 15)) dates.push(iso)
    cursor.setDate(cursor.getDate() + 1)
  }
  if (!dates.length) dates.push(start)
  if (!phone) return dates
  if (dates.length <= 2) return dates
  return [dates[0], dates[Math.ceil((dates.length - 1) / 2)]]
}
