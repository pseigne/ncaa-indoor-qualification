import {
  accessibleConversion, familyName, formatMark, ordinal, surname, symbolString,
} from './format'

// Meters ahead of the line when the line mark finishes. Average speed over the distance.
export function metersAhead(dist, lineV, v) {
  return dist * (lineV / v - 1)
}

export function formatMeters(meters, digits = 1) {
  return `${Math.abs(meters).toFixed(digits)}\u2009m`
}

const RACE_STEPS = [0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100]
const FIELD_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20]

// How far each mark stands from the line, in meters, and the words for it. A race estimates the gap from
// each mark's average speed when the line mark finishes; a jump or a throw measures it. Null without a scale.
export function raceScale(dist) {
  if (!Number.isFinite(dist) || dist <= 0) return null
  return {
    gap: (lineV, v) => metersAhead(dist, lineV, v),
    ahead: 'ahead',
    behind: 'behind',
    back: 'back',
    beyond: 'ahead of',
    digits: 1,
    steps: RACE_STEPS,
    estimate: true,
    noun: 'race',
    opening: (top, lineV) => `The top ${top} placed as one race at the moment ${formatMark(lineV, 'time')} finishes`,
  }
}

export function fieldScale(name) {
  const upward = /high jump|vault/i.test(name || '')
  return {
    gap: (lineV, v) => v - lineV,
    ahead: upward ? 'higher' : 'farther',
    behind: upward ? 'lower' : 'shorter',
    back: upward ? 'lower' : 'short',
    beyond: upward ? 'higher than' : 'farther than',
    digits: 2,
    steps: FIELD_STEPS,
    estimate: false,
    noun: 'competition',
    opening: (top, lineV) => `The top ${top} measured against the line, ${formatMark(lineV, 'mark')}`,
  }
}

export function scaleFor(event) {
  if (event.kind === 'time') return raceScale(event.dist)
  if (event.kind === 'mark') return fieldScale(event.name)
  return null
}

// Decimals for a tick step: 0.25 m needs two, 0.5 m one, 2 m none.
function stepDigits(step) {
  return step >= 1 ? 0 : Number.isInteger(Math.round(step * 1000) / 100) ? 1 : 2
}

function sideWord(meters, scale) {
  return meters > 0 ? scale.ahead : scale.back
}

// How deep the race runs. Saved lists were at most 60 deep when the strip was drawn for them, so it holds 60
// places, or 12 past the deeper of the qualifying line and the field line when that is further down. A
// 100-deep outdoor list keeps every row in its table; the race stops here.
export const STRIP_DEPTH = 60
export const STRIP_PAST_LINE = 12

export function stripDepth(lineRank, fieldRank = null) {
  const deepest = Math.max(Number.isInteger(lineRank) ? lineRank : 0, Number.isInteger(fieldRank) ? fieldRank : 0)
  return Math.max(STRIP_DEPTH, deepest + STRIP_PAST_LINE)
}

// Where the field line crosses the race: halfway between the deepest place the field took and the next
// place, or just behind the deepest when the race stops there.
export function fieldMeters(placed, rank) {
  const deepest = placed.find(dot => dot.rank === rank)
  if (!deepest) return null
  const next = placed.find(dot => dot.rank === rank + 1)
  return next ? (deepest.m + next.m) / 2 : deepest.m - 0.5
}

// "60 of 100" when the race stops short of the list, the list's length when it does not.
export function topWords(shown, listed) {
  return listed > shown ? `${shown} of ${listed}` : `${shown}`
}

// Place direct labels so they do not cross the qualifying line or each other.
// A label that does not fit tries a shorter line, then drops.
// Lane hairlines are horizontal rules between stacked rows; color is applied by the page, never here.
export function layoutStrip({
  rows,
  lineV,
  dist,
  scale = raceScale(dist),
  rank,
  width,
  radius,
  phone = false,
  domain = null,
  charWidth = 7.2,
  lineConversion = null,
  listed = rows.length,
}) {
  const usable = rows.filter(row => Number.isFinite(row.v) && row.v > 0 && Number.isFinite(lineV) && lineV > 0)
  if (!usable.length || !scale) return null

  const points = usable.map(row => ({ ...row, m: scale.gap(lineV, row.v) }))
  const mMax = domain ? domain[1] : Math.max(0, ...points.map(p => p.m))
  const mMin = domain ? domain[0] : Math.min(0, ...points.map(p => p.m))
  const pad = radius + 2
  const plotW = Math.max(1, width - 2 * pad)
  const nearestBehind = points.reduce((best, point) => (
    point.m < -1e-6 && (!best || point.m > best.m) ? point : best
  ), null)
  let lo = mMin
  if (!domain && nearestBehind) {
    const label = `${ordinal(nearestBehind.rank)}, ${formatMeters(nearestBehind.m, scale.digits)} ${scale.back}`
    const labelPx = 2 * radius + label.length * charWidth
    lo = Math.min(mMin, -(labelPx * mMax) / Math.max(1, plotW - labelPx))
  }
  const span = (mMax - lo) || 1
  const xAt = meters => pad + (meters - lo) / span * plotW
  const lane = 2 * radius + (phone ? 5 : 8)
  const placed = []
  points.forEach(row => {
    const p = xAt(row.m)
    let k = 0
    while (placed.some(q => q.k === k && Math.abs(q.x - p) < 2 * radius + 1)) k += 1
    placed.push({ ...row, x: p, k })
  })
  const kMax = Math.max(...placed.map(q => q.k))
  const lineX = xAt(0)
  const at = place => placed.find(q => q.rank === place)
  const bubble = at(rank)
  const firstOut = at(rank + 1)
  const leader = at(1)
  const last = placed[placed.length - 1]
  const lineName = bubble ? familyName(bubble.name) : ''
  const candidates = [
    bubble && {
      id: 'line',
      q: bubble,
      texts: phone || !lineName ? ['Qualifying line'] : [`Qualifying line · ${lineName}, ${ordinal(rank)}`, 'Qualifying line'],
      cls: 'a',
      at: lineX + 8,
      anchor: 'start',
      lead: false,
      row: phone ? 0 : 1,
    },
    firstOut && {
      id: 'out',
      q: firstOut,
      texts: [
        `${surname(firstOut.name) || ordinal(firstOut.rank)}, first one out, ${formatMeters(firstOut.m, scale.digits)} ${scale.back}`,
        `${ordinal(firstOut.rank)}, ${formatMeters(firstOut.m, scale.digits)} ${scale.back}`,
      ],
      cls: 'k',
      anchor: 'end',
    },
    leader && leader !== bubble && {
      id: 'first',
      q: leader,
      texts: [
        surname(leader.name)
          ? `${surname(leader.name)}, 1st, ${formatMeters(leader.m, scale.digits)} ${scale.ahead}`
          : `1st, ${formatMeters(leader.m, scale.digits)} ${scale.ahead}`,
        `1st, ${formatMeters(leader.m, scale.digits)} ${scale.ahead}`,
      ],
      cls: 'k',
      anchor: 'end',
    },
    last && last !== firstOut && {
      id: 'last',
      q: last,
      texts: [`${ordinal(last.rank)}, ${formatMeters(last.m, scale.digits)} ${sideWord(last.m, scale)}`],
      cls: '',
      anchor: last.m < 0 ? 'end' : 'start',
    },
  ].filter(Boolean)

  const used = [[], []]
  const leads = []
  let rowsUsed = 0
  const labels = []
  for (const candidate of candidates) {
    if (phone && candidate.lead !== false && candidate.id !== 'out' && candidate.id !== 'first') continue
    for (const text of candidate.texts) {
      const anchorX = candidate.at ?? candidate.q.x
      const textWidth = text.length * charWidth
      let x0 = candidate.anchor === 'end' ? anchorX - textWidth : anchorX
      let x1 = x0 + textWidth
      let anchor = candidate.anchor
      if (candidate.id === 'line') {
        // The line's own label sits right of the line; with no room there it ends 6px left of the line.
        // It never slides across the line, and with room on neither side it is left out.
        if (x1 > width) {
          x1 = lineX - 6
          x0 = x1 - textWidth
          anchor = 'end'
        }
        if (x0 < 0 || x1 > width) continue
      }
      if (x0 < 0) { x1 -= x0; x0 = 0 }
      if (x1 > width) { x0 -= x1 - width; x1 = width }
      const crossesLine = x0 < lineX + 4 && x1 > lineX - 4
      if (candidate.lead !== false && crossesLine) continue
      const free = row => used[row].every(([a, b]) => x1 + 14 < a || x0 - 14 > b) && (
        row === 0
          ? leads.every(x => x < x0 - 4 || x > x1 + 4)
          : (candidate.lead === false || used[0].every(([a, b]) => candidate.q.x < a - 4 || candidate.q.x > b + 4))
      )
      const row = candidate.row != null ? candidate.row : free(0) ? 0 : (!phone && free(1)) ? 1 : -1
      if (row < 0) continue
      used[row].push([x0, x1])
      if (row === 1 && candidate.lead !== false) leads.push(candidate.q.x)
      rowsUsed = Math.max(rowsUsed, row + 1)
      const stackTop = Math.max(candidate.q.k, ...placed.filter(q => Math.abs(q.x - candidate.q.x) < 2 * radius).map(q => q.k))
      labels.push({
        id: candidate.id, text, cls: candidate.cls, x0, x1, row, anchor, rank: candidate.q.rank,
        lead: candidate.lead !== false, stackTop, dotX: candidate.q.x,
      })
      break
    }
  }

  const labH = rowsUsed * 20
  const top = 14
  const y0 = top + labH + 10 + kMax * lane + radius
  const yAt = k => y0 - k * lane
  const axisY = y0 + lane / 2 + 18
  const height = axisY + 4
  labels.forEach(label => {
    const ly = top + (rowsUsed - 1 - label.row) * 20
    label.y = ly + 4
    if (label.lead) {
      label.leader = {
        x1: label.dotX,
        x2: label.dotX,
        y1: ly + 10,
        y2: yAt(label.stackTop) - radius - 3,
      }
    } else label.leader = null
  })

  const lanes = []
  for (let k = -1; k <= kMax; k += 1) lanes.push({ x1: 0, x2: width, y: yAt(k) - lane / 2 })

  const { steps } = scale
  const maxTicks = phone ? 3 : 7
  const step = steps.find(s => (Math.floor(mMax / s) + Math.floor(-lo / s)) <= maxTicks) || steps.at(-1)
  const ticks = []
  const tickAt = (m, digits) => {
    const text = `${formatMeters(m, digits)} ${m > 0 ? scale.ahead : scale.behind}`
    const x = xAt(m)
    const w = text.length * charWidth
    if (x - w / 2 < 0 || x + w / 2 > width || Math.abs(x - lineX) < w / 2 + 12 || ticks.some(o => Math.abs(o.x - x) < w + 12)) return null
    return { x, text }
  }
  for (let m = -Math.floor(-lo / step) * step; m <= mMax + 1e-9; m += step) {
    if (Math.abs(m) < 1e-9) continue
    const tick = tickAt(m, stepDigits(step))
    if (tick) ticks.push(tick)
  }
  // A side left without a tick (its ticks ran into the edge or the line) gets the roundest distance that
  // fits there, and failing that the distance at the strip's end. When neither fits, that side has no
  // distance label at all: never a bare "behind" or "ahead".
  const ends = []
  for (const side of [-1, 1]) {
    if (ticks.some(tick => side * (tick.x - lineX) > 0)) continue
    const reach = side < 0 ? -lo : mMax
    let tick = null
    for (const s of [...steps].reverse()) {
      for (let m = Math.floor(reach / s + 1e-9) * s; m >= s - 1e-9 && !tick; m -= s) tick = tickAt(side * m, stepDigits(s))
      if (tick) break
    }
    if (tick) {
      ticks.push(tick)
      continue
    }
    const text = `${formatMeters(reach, reach < 10 ? scale.digits : 0)} ${side < 0 ? scale.behind : scale.ahead}`
    const room = side < 0 ? lineX : width - lineX
    if (reach > 1e-9 && room > text.length * charWidth + 12) ends.push({ x: side < 0 ? 0 : width, text, anchor: side < 0 ? 'start' : 'end' })
  }
  ticks.sort((a, b) => a.x - b.x)

  const dots = placed.map(q => ({ ...q, y: yAt(q.k) }))
  const first = dots.find(q => q.rank === 1)
  const outside = dots.find(q => q.rank === rank + 1)
  const phrase = accessibleConversion(lineConversion)
  const aria = [
    `${scale.opening(topWords(rows.length, listed), lineV)}${phrase ? `, ${phrase}` : ''}.`,
    first ? `${surname(first.name) || '1st'} is ${formatMeters(first.m, scale.digits)} ${scale.beyond} the line.` : '',
    outside ? `The first one out is ${formatMeters(outside.m, scale.digits)} ${scale.back}.` : '',
    scale.estimate ? 'Meters are estimates.' : '',
  ].filter(Boolean).join(' ')

  return {
    width, height, top, baseY: y0, readoutY: top + Math.max(labH, 20) - 16,
    viewY: top - 18, viewHeight: height - (top - 18),
    radius, lane, kMax, lineX, xAt, mMin, mMax,
    placed: dots, lanes, labels, ticks, ends, axisY, aria, scale,
  }
}


function boxesMeet(a, b, gap = 0) {
  return a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.y0 < b.y1 + gap && a.y1 > b.y0 - gap
}

// The same race turned upright for the wide split view: ahead at the top, behind at the bottom.
// Meter labels sit in a gutter on the left edge and runner labels in a gutter on the right. Between them,
// eight lanes on nine lines, inset 16px from each gutter; each dot sits in the middle of its lane.
// Dots closer than GROUP_GAP to their neighbour, one after another, form a group. A group takes the lanes
// in pairs from the middle out, best place first, and every dot keeps its exact height where it can. No
// two dots touch, and two dots in one lane are always LANE_GAP apart. `bottom` keeps a strip of the
// column free for the chip that points back to an off-screen row.
export const LANES = 8
export const LANE_ORDER = [4, 5, 3, 6, 2, 7, 1, 8]
export const GROUP_GAP = 16
export const LANE_GAP = 16
const PAIRS = [[4, 5], [3, 6], [2, 7], [1, 8]]
const OUTSIDE_IN = [1, 8, 2, 7, 3, 6, 4, 5]

// How far a lane sits from the middle of the track: lanes 4 and 5 are 0, lanes 1 and 8 are 3.
export function laneDepth(lane) {
  return Math.abs(lane - (LANES + 1) / 2) - 0.5
}

// Places every dot, group by group from the top. Places 1 to 8 of a group take the pairs 4/5, 3/6, 2/7
// and 1/8 in turn, so a better place never has a less central lane; within a pair the better place takes
// the lane whose nearest dot above is further away, which keeps single runners from stacking into a
// tower. Place 9 onward tries the lanes from the outside in at its own height, and only then a spot
// half a dot over and lower down that touches nothing. Boxes in `avoid` (the qualifying label) count as
// dots already there.
export function placeDots(groups, { radius: r, laneX, avoid = [] }) {
  const placed = []
  const touches = (x, y) => placed.some(q => Math.hypot(q.x - x, q.y - y) < 2 * r + 1)
    || avoid.some(box => x + r + 2 > box.x0 && x - r - 2 < box.x1 && y + r + 2 > box.y0 && y - r - 2 < box.y1)
  const laneFree = (lane, y) => placed.every(q => q.lane !== lane || Math.abs(q.y - y) >= LANE_GAP)
  const nearest = (lane, y) => Math.min(Infinity, ...placed.filter(q => q.lane === lane).map(q => Math.abs(q.y - y)))
  const fits = (lane, x, y) => laneFree(lane, y) && !touches(x, y)
  groups.forEach(group => {
    const id = group[0].rank
    let partner = null
    group.forEach((row, index) => {
      const put = (lane, x, y, offset) => placed.push({ ...row, lane, x, y, offset, group: id })
      if (index < LANES) {
        let lane = partner
        if (index % 2 === 0) {
          const [a, b] = PAIRS[index / 2]
          lane = nearest(a, row.y) >= 2 * LANE_GAP || nearest(a, row.y) >= nearest(b, row.y) ? a : b
          partner = lane === a ? b : a
        }
        if (fits(lane, laneX(lane), row.y)) {
          put(lane, laneX(lane), row.y, false)
          return
        }
      }
      const lane = OUTSIDE_IN.find(l => fits(l, laneX(l), row.y))
      if (lane) {
        put(lane, laneX(lane), row.y, false)
        return
      }
      for (let k = 1; k < 400; k += 1) {
        const y = row.y + k * r
        const spot = OUTSIDE_IN.find(l => fits(l, laneX(l) + (l > LANES / 2 ? -r : r), y))
        if (spot) {
          put(spot, laneX(spot) + (spot > LANES / 2 ? -r : r), y, true)
          return
        }
      }
      put(OUTSIDE_IN[0], laneX(OUTSIDE_IN[0]), row.y, false)
    })
  })
  return placed
}

// A leader from a dot to its label that touches no other dot: out to the lane line on the dot's right,
// along that line (dots never reach a lane line) to a height where the way across the track is clear,
// then over the track and into the gutter to the label.
export function routeLeader({ radius: r, placed, lanes, laneTo, floor }, dot, x2, y2) {
  const others = placed.filter(q => q !== dot)
  const startX = dot.x + r + 1
  const lineX = Math.max(startX, lanes[dot.lane]?.x ?? startX)
  const exitX = laneTo + 2
  const across = (x0, x1, y) => others.every(q => q.x + r + 1 < x0 || q.x - r - 1 > x1 || Math.abs(q.y - y) > r + 1)
  const along = (x, y0, y1) => others.every(q => Math.abs(q.x - x) > r + 1 || q.y + r + 1 < Math.min(y0, y1) || q.y - r - 1 > Math.max(y0, y1))
  let y = dot.y
  for (let d = 0; d <= floor; d += 1) {
    const found = [dot.y + d, dot.y - d].find(c => c >= 0 && c <= floor && along(lineX, dot.y, c) && across(lineX, exitX, c))
    if (found != null) {
      y = found
      break
    }
  }
  const points = [[startX, dot.y], [lineX, dot.y], [lineX, y], [exitX, y], [x2, y2]]
  return points.filter((point, index) => !index || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1])
}

// A relay team's letter, as in "Oregon (B)".
const SUFFIX = /\s*\([A-Z]\)$/
const LINE_H = 17
export const FIELD_TAG = { w: 66, h: 18 }

// Estimated text width; the page passes a measured one when it can.
export function estimateWidth(text, { charWidth = 7.2 } = {}) {
  return String(text).length * charWidth
}

// Places runners whose dots would touch into groups: each dot within GROUP_GAP of the one above joins it.
export function groupByHeight(points, gap = GROUP_GAP) {
  const sorted = [...points].sort((a, b) => a.y - b.y || a.rank - b.rank)
  const groups = []
  sorted.forEach((point, index) => {
    if (index && point.y - sorted[index - 1].y <= gap) groups.at(-1).push(point)
    else groups.push([point])
  })
  return groups.map(group => group.sort((a, b) => a.rank - b.rank))
}

// Breaks a line to fit `max`: first at the middle dots, then between words. Nothing is dropped.
export function wrapLine(line, max, width) {
  if (width(line) <= max) return [line]
  const out = []
  let current = ''
  const push = piece => {
    const next = current ? `${current} ${piece}` : piece
    if (!current || width(next) <= max) current = next
    else {
      out.push(current)
      current = piece
    }
  }
  line.split(' · ').forEach((part, index) => {
    if (index && current) {
      const joined = `${current} · ${part}`
      if (width(joined) <= max) {
        current = joined
        return
      }
      out.push(current)
      current = ''
    }
    if (width(part) <= max) push(part)
    else part.split(' ').forEach(push)
  })
  if (current) out.push(current)
  return out
}

export function layoutColumn({
  rows,
  lineV,
  dist,
  scale = raceScale(dist),
  rank,
  fieldRank = null,
  width,
  height,
  radius = 5,
  bottom = 0,
  inset = 16,
  minPitch = 16,
  charWidth = 7.2,
  measure = null,
  lineConversion = null,
  listed = rows.length,
}) {
  const usable = rows.filter(row => Number.isFinite(row.v) && row.v > 0 && Number.isFinite(lineV) && lineV > 0)
  if (!usable.length || !scale || !(width > 0) || !(height > 0)) return null

  const textW = (text, bold = false) => (measure ? measure(text, bold) : estimateWidth(text, { charWidth }))
  const points = usable.map(row => ({ ...row, m: scale.gap(lineV, row.v) }))
  const mMax = Math.max(0, ...points.map(p => p.m))
  const mMin = Math.min(0, ...points.map(p => p.m))
  const span = (mMax - mMin) || 1
  const top = 14
  const r = radius

  // About one tick every 64px, snapped to the same nice steps as the flat strip.
  const maxTicks = Math.max(3, Math.min(12, Math.floor((height - bottom - 2 * top) / 64)))
  const step = scale.steps.find(s => (Math.floor(mMax / s) + Math.floor(-mMin / s)) <= maxTicks) || scale.steps.at(-1)
  const digits = stepDigits(step)
  const tickText = m => `${formatMeters(m, digits)} ${m > 0 ? scale.ahead : scale.behind}`
  const widest = [step, -step, Math.floor(mMax / step) * step, Math.ceil(mMin / step) * step]
    .filter(m => Math.abs(m) > 1e-9)
    .map(m => textW(tickText(m)))
  const gutter = Math.ceil(Math.max(textW(scale.behind), textW(scale.ahead), ...widest)) + 10

  const padTop = top + r + 2
  const padBottom = bottom + 2 * r + 12
  const plotH = Math.max(1, height - padTop - padBottom)
  const yAt = meters => padTop + (mMax - meters) / span * plotH
  const lineY = yAt(0)
  const floor = height - bottom

  // What the four permanent labels say, two lines each. The right gutter is as wide as their longest line,
  // leaving lanes at least `minPitch` wide; a label that still does not fit drops a relay team's letter,
  // and only then breaks.
  const at = place => points.find(q => q.rank === place)
  const nameOf = q => familyName(q.name)
  const named = (q, place, short = false) => {
    const name = short ? nameOf(q).replace(SUFFIX, '') : nameOf(q)
    return name ? `${name}, ${place}` : place
  }
  const away = q => `${formatMeters(q.m, scale.digits)}\u00a0${q.m > 0 ? scale.ahead : scale.back}`
  const bubble = at(rank)
  const leader = at(1)
  const firstOut = at(rank + 1)
  const last = points.reduce((a, b) => (b.rank > a.rank ? b : a), points[0])
  const lineLines = bubble && nameOf(bubble) ? ['Qualifying line', named(bubble, ordinal(rank))] : ['Qualifying line']
  const wanted = [
    leader && leader !== bubble && {
      q: leader, cls: 'k', forms: short => [named(leader, '1st', short), away(leader)],
    },
    firstOut && {
      q: firstOut, cls: 'k', forms: short => ['First one out', named(firstOut, ordinal(firstOut.rank), short)],
    },
    last && last !== firstOut && last !== leader && last !== bubble && {
      q: last, cls: '', forms: short => [named(last, ordinal(last.rank), short), away(last)],
    },
  ].filter(Boolean)
  const need = Math.max(
    ...lineLines.map(line => textW(line, true)),
    ...wanted.flatMap(label => label.forms(false).map(line => textW(line, label.cls === 'k'))),
  )
  const roomForLabels = width - gutter - 2 * inset - LANES * Math.max(minPitch, 2 * r + 2)
  const labelGutter = Math.max(0, Math.min(Math.ceil(need), roomForLabels))

  const left = gutter + inset
  const right = Math.max(left + LANES, width - labelGutter - inset)
  const pitch = (right - left) / LANES
  const lineX = index => left + index * pitch
  const laneX = lane => lineX(lane - 0.5)
  // Labels may also use the inset up to 2px from the last lane line; no dot reaches past a lane line.
  const labelRoom = labelGutter + inset - 2
  const lanes = Array.from({ length: LANES + 1 }, (_, index) => ({ x: lineX(index), y1: 0, y2: floor }))

  // The qualifying label sits above the red rule at the right edge, on two short lines.
  const lineW = Math.max(...lineLines.map(line => textW(line, true)))
  const lineH = lineLines.length * LINE_H
  const lineLabel = {
    lines: lineLines, x: width, anchor: 'end', x0: width - lineW, x1: width, y0: lineY - 6 - lineH, y1: lineY - 6,
  }
  const dots = placeDots(groupByHeight(points.map(row => ({ ...row, y: yAt(row.m) }))), { radius: r, laneX, avoid: [lineLabel] })
  dots.sort((a, b) => a.rank - b.rank)
  const kMax = Math.max(...dots.map(q => LANE_ORDER.indexOf(q.lane)))
  const track = { radius: r, placed: dots, lanes, laneTo: lineX(LANES), floor }
  const dot = place => dots.find(q => q.rank === place)

  const dotBoxes = dots.map(q => ({ x0: q.x - r - 2, x1: q.x + r + 2, y0: q.y - r - 2, y1: q.y + r + 2 }))
  lineLabel.halo = dotBoxes.some(box => boxesMeet(box, lineLabel))

  // The other three sit in the right gutter, as close to their dot's height as the others allow,
  // each joined to its dot by a hairline.
  const taken = [lineLabel, { x0: 0, x1: width, y0: lineY - 2, y1: lineY + 2 }]
  // The field line runs across the lanes; its tag sits at the line's right end, on the line's own side of
  // the qualifying line, and the labels below keep clear of it.
  const fieldM = fieldRank != null ? fieldMeters(dots, fieldRank) : null
  let field = null
  if (fieldM != null) {
    const y = yAt(fieldM)
    const side = y > lineY ? 1 : -1
    const x0 = Math.min(lineX(LANES) + 6, width - FIELD_TAG.w)
    const tagBox = top => ({ x0, x1: x0 + FIELD_TAG.w, y0: top, y1: top + FIELD_TAG.h })
    let top = y - FIELD_TAG.h / 2
    for (let shift = 0; shift <= height && taken.some(box => boxesMeet(tagBox(top), box, 3)); shift += 1) {
      top = y - FIELD_TAG.h / 2 + side * shift
    }
    const tag = tagBox(Math.min(Math.max(top, 0), floor - FIELD_TAG.h))
    field = { y, tag, rank: fieldRank }
    taken.push(tag)
  }
  const labels = wanted
    .map(label => ({ ...label, q: dot(label.q.rank) }))
    .sort((a, b) => a.q.y - b.q.y)
    .map(({ q, cls, forms }) => {
      const fits = form => form.every(line => textW(line, cls === 'k') <= labelRoom)
      const raw = fits(forms(false)) ? forms(false) : forms(true)
      const lines = raw.flatMap(line => wrapLine(line, labelRoom, text => textW(text, cls === 'k')))
      const w = Math.max(...lines.map(line => textW(line, cls === 'k')))
      const h = lines.length * LINE_H
      const box = y0 => ({ x0: width - w, x1: width, y0, y1: y0 + h })
      const ideal = Math.min(Math.max(q.y - h / 2, 0), floor - h)
      // The last place's label is only a reference: it stays on its dot's side of the line or is left out.
      const ownSide = y => cls !== '' || (q.y > lineY ? y > lineY : y + h < lineY)
      let y0 = null
      for (let shift = 0; shift <= height; shift += 2) {
        const options = [ideal + shift, ideal - shift].filter(y => y >= 0 && y + h <= floor && ownSide(y))
        const free = options.find(y => !taken.some(other => boxesMeet(box(y), other, 4)))
        if (free != null) {
          y0 = free
          break
        }
      }
      if (y0 == null) {
        if (cls === '') return null
        y0 = ideal
      }
      const placed = { ...box(y0), lines, x: width, anchor: 'end', cls, rank: q.rank }
      placed.leader = { points: routeLeader(track, q, placed.x0 - 4, y0 + Math.min(h, LINE_H * 2) / 2) }
      taken.push(placed)
      return placed
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)

  const ticks = []
  for (let m = Math.ceil((mMin - 1e-9) / step) * step; m <= mMax + 1e-9; m += step) {
    if (Math.abs(m) < 1e-9) continue
    const y = yAt(m)
    if (Math.abs(y - lineY) < 16 || y < 8 || y > floor - 4 || ticks.some(o => Math.abs(o.y - y) < 22)) continue
    ticks.push({ y, text: tickText(m) })
  }
  const ends = []
  if (!ticks.some(tick => tick.y < lineY) && lineY > 28) ends.push({ y: Math.max(14, yAt(mMax) + 5), text: scale.ahead })
  if (!ticks.some(tick => tick.y > lineY) && floor - lineY > 28) ends.push({ y: Math.min(floor - 4, yAt(mMin) + 5), text: scale.behind })

  const phrase = accessibleConversion(lineConversion)
  const aria = [
    `${scale.opening(topWords(rows.length, listed), lineV)}${phrase ? `, ${phrase}` : ''}, ${scale.ahead} at the top.`,
    leader ? `${surname(leader.name) || '1st'} is ${formatMeters(leader.m, scale.digits)} ${scale.beyond} the line.` : '',
    firstOut ? `The first one out is ${formatMeters(firstOut.m, scale.digits)} ${scale.back}.` : '',
    scale.estimate ? 'Meters are estimates.' : '',
  ].filter(Boolean).join(' ')

  return {
    width, height, bottom, gutter, labelGutter, labelRoom, radius: r, pitch, kMax, lineY, yAt, mMin, mMax, step, charWidth,
    laneFrom: lineX(0), laneTo: lineX(LANES), textW,
    placed: dots, lanes, lineLabel, labels, ticks, ends, aria, field, scale,
  }
}

// Two short lines beside the dot: who, then the mark and how far from the line. Where that would cover
// another dot, the label moves to the right gutter, breaks to fit it, and a hairline leads back to the dot.
export function placeReadout(layout, dot, kind, lineRank) {
  const head = `${dot.rank}. ${surname(dot.name) || `Place ${dot.rank}`}`
  const mark = formatMark(dot.v, kind)
  const sym = symbolString(dot.conversion)
  const { scale } = layout
  const away = dot.rank === lineRank ? 'on the line' : `${formatMeters(dot.m, scale.digits)} ${sideWord(dot.m, scale)}`
  const { textW, radius: r, width, gutter, labelRoom } = layout
  const floor = layout.height - layout.bottom
  const markW = textW(`${mark}${sym}`)
  const besideW = Math.max(textW(head, true), textW(`${mark}${sym} · ${away}`))
  const others = layout.placed.filter(o => o !== dot)
  const line = layout.lineLabel
  const boxes = [line, layout.field?.tag].filter(Boolean)
  const onLine = (x0, x1, y0, y1) => boxes.some(box => x0 < box.x1 + 4 && x1 > box.x0 - 4 && y0 < box.y1 + 4 && y1 > box.y0 - 4)
  const clearOf = (x0, x1, y0, y1) => others.every(o => o.x + r + 2 < x0 || o.x - r - 2 > x1 || o.y + r + 2 < y0 || o.y - r - 2 > y1)
  const spots = [
    [dot.x + r + 8, 'start', dot.y - 3],
    [dot.x + r + 4, 'start', dot.y - r - 25],
    [dot.x + r + 4, 'start', dot.y + r + 16],
    [dot.x - r - 8, 'end', dot.y - 3],
    [dot.x - r - 4, 'end', dot.y - r - 25],
    [dot.x - r - 4, 'end', dot.y + r + 16],
  ].map(([x, anchor, y]) => ({ x, anchor, y, x0: anchor === 'start' ? x : x - besideW }))
  const beside = spots.find(s => s.x0 >= gutter && s.x0 + besideW <= width && s.y - 13 >= 0 && s.y + 21 <= floor
    && clearOf(s.x0, s.x0 + besideW, s.y - 13, s.y + 21) && !onLine(s.x0, s.x0 + besideW, s.y - 13, s.y + 21))
  let lines
  let spot
  let leader = null
  if (beside) {
    lines = [{ text: head }, { mark, sym, tail: ` · ${away}` }]
    spot = beside
  } else {
    const room = Math.max(labelRoom, markW)
    const heads = wrapLine(head, room, text => textW(text, true)).map(text => ({ text }))
    const rest = textW(`${mark}${sym} · ${away}`) <= room ? [{ mark, sym, tail: ` · ${away}` }] : [{ mark, sym }, { text: away }]
    lines = [...heads, ...rest]
    const w = Math.max(...heads.map(line => textW(line.text, true)), rest.length > 1 ? Math.max(markW, textW(away)) : textW(`${mark}${sym} · ${away}`))
    const h = lines.length * 17
    const x0 = width - w
    // As near the dot's height as it can sit without touching the qualifying label.
    const ideal = Math.min(Math.max(dot.y - h / 2, 0), floor - h)
    let top = ideal
    for (let shift = 0; shift <= floor; shift += 2) {
      const free = [ideal + shift, ideal - shift].find(y => y >= 0 && y + h <= floor && !onLine(x0, width, y, y + h))
      if (free != null) {
        top = free
        break
      }
    }
    spot = { x: width, anchor: 'end', y: top + 13, x0: width - w }
    const track = { radius: r, placed: layout.placed, lanes: layout.lanes, laneTo: layout.laneTo, floor }
    leader = { points: routeLeader(track, dot, spot.x0 - 4, top + Math.min(h, 34) / 2) }
  }
  const w = spot.anchor === 'end' ? spot.x - spot.x0 : besideW
  return { lines, x: spot.x, y: spot.y, anchor: spot.anchor, x0: spot.x0, x1: spot.x0 + w, leader }
}

// Text widths from the page's own font, so the gutters fit the words. Null where there is no canvas.
export function canvasMeasure() {
  if (typeof document === 'undefined' || /jsdom/i.test(globalThis.navigator?.userAgent || '')) return null
  let context = null
  try { context = document.createElement('canvas').getContext('2d') } catch { return null }
  if (!context) return null
  const cache = new Map()
  return (text, bold = false) => {
    const key = `${bold ? 1 : 0}${text}`
    if (!cache.has(key)) {
      context.font = `${bold ? 600 : 400} 14px Archivo, system-ui, sans-serif`
      cache.set(key, context.measureText(String(text)).width * 1.03 + 1)
    }
    return cache.get(key)
  }
}

// The names a strip readout can use, longest first: "M. Endrody", then "Endrody". A relay team has only its
// own name. Stored athlete names read "Last, First".
export function readoutNames(name) {
  if (!name || name === 'N/A') return []
  const clean = String(name).replace(/'/g, '\u2019')
  const [last, first] = clean.split(', ')
  if (!first) return [clean]
  return [`${first.trim()[0]}. ${last}`, last]
}

// Fits the strip readout ("14. M. Endrody · 3:53.65 · 1.7 m ahead") inside the strip without cutting it.
// Tries each name, longest first, at the dot's usual anchor and then flipped to either side of the dot;
// only when no name fits does it drop the distance, then the mark. Never shortens text with an ellipsis.
// `parts(name, { tail, mark })` returns the text to measure; `measure(text)` its width.
export function fitReadout({ x, width, names, parts, measure, edge = 4 }) {
  const usual = x < width * 0.25 ? 'start' : x > width * 0.75 ? 'end' : 'middle'
  const anchors = [usual, ...['start', 'end', 'middle'].filter(anchor => anchor !== usual)]
  const spans = (anchor, w) => (anchor === 'start' ? [x, x + w] : anchor === 'end' ? [x - w, x] : [x - w / 2, x + w / 2])
  const options = [{ tail: true, mark: true }, { tail: false, mark: true }, { tail: false, mark: false }]
  for (const keep of options) {
    for (const name of names) {
      const w = measure(parts(name, keep))
      for (const anchor of anchors) {
        const [a, b] = spans(anchor, w)
        if (a >= edge && b <= width - edge) return { x, anchor, name, ...keep }
      }
    }
  }
  const name = names.at(-1) || ''
  const w = measure(parts(name, options.at(-1)))
  return { x: Math.min(Math.max(x, edge), width - edge), anchor: x - w < edge ? 'start' : 'end', name, ...options.at(-1) }
}
