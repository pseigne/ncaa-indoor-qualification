import { familyName, formatMark, ordinal } from './format'
import { FIELD_TAG, estimateWidth, fitReadout, formatMeters, readoutNames, topWords } from './strip'

// Jumps and throws drawn on their own venue: a throwing circle and its landing sector with the line as an
// arc, a bar set at the line between two standards, or a sand pit with the line across it. Every mark sits
// at its own distance or height, and places with the same mark spread across the venue. The venue stands
// upright beside the table on wide screens (farther or higher up) and lies flat in the card on phones
// (farther to the right; a bar stays a bar, higher up).

export function sceneFor(name) {
  const n = String(name || '').toLowerCase()
  if (/vault/.test(n)) return 'vault'
  if (/high jump/.test(n)) return 'bar'
  if (/long jump|triple jump/.test(n)) return 'pit'
  if (/javelin/.test(n)) return 'javelin'
  if (/shot|weight|discus|hammer/.test(n)) return 'sector'
  return null
}

// The flat card's height: a sector needs the most room across, a pit the least.
export function sceneHeight(scene, width) {
  const wide = width >= 600
  if (scene === 'pit') return wide ? 230 : 196
  if (scene === 'bar' || scene === 'vault') return wide ? 250 : 216
  return wide ? 300 : 236
}

// The sector's full angle in degrees: 34.92° for the circle throws, 28.96° for the javelin.
const SECTOR_DEG = { sector: 34.92, javelin: 28.96 }
const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20]
const LINE_H = 17

function stepDigits(step) {
  return step >= 1 ? 0 : Number.isInteger(Number((step * 10).toFixed(6))) ? 1 : 2
}

function meet(a, b, gap = 0) {
  return a && b && a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.y0 < b.y1 + gap && a.y1 > b.y0 - gap
}

// A label of one or more lines from its anchor point and first baseline, with the box it covers.
function textBox(lines, x, y, anchor, textW) {
  const w = Math.max(...lines.map(line => textW(line.text, line.bold)))
  const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x
  return { lines, x, y, anchor, x0, x1: x0 + w, y0: y - 13, y1: y + (lines.length - 1) * LINE_H + 4 }
}

// The throwing circle (or the javelin's runway and arc) at the apex, the sector opening from it. Distance
// runs along the radius; the part from the circle to the nearest mark is cut short at the break, so the
// marks get the room. `s` is a mark's place across the sector, as arc length.
function sectorGeo({ W, H, upright, scene, D0, D1, lineV, fieldV, tickW }) {
  const a = (SECTOR_DEG[scene] / 2) * Math.PI / 180
  const sinA = Math.sin(a)
  const share = 0.44
  const frac = d => (d - D0) / (D1 - D0)
  const at = rMax => d => rMax * share + frac(d) * rMax * (1 - share)
  let rMax
  let ax
  let ay
  let top = 0
  if (upright) {
    const T = 34
    const B = 16
    const tall = H - T - B - 12
    // Room beside the sector for the line's label on the left and the field tag and distances on the right,
    // less what the sector's own slope leaves free at that radius.
    const sides = r => {
      const rho = at(r)
      const left = tickW + 14
      const right = Math.max(14, fieldV != null ? FIELD_TAG.w + 14 - (r - rho(fieldV)) * sinA : 0)
      return [left, right]
    }
    rMax = tall
    for (let i = 0; i < 8; i += 1) {
      const [left, right] = sides(rMax)
      rMax = Math.max(40, Math.min(tall, (W - left - right) / (2 * sinA)))
    }
    const [left, right] = sides(rMax)
    ax = left + rMax * sinA + Math.max(0, (W - left - right - 2 * rMax * sinA) / 2)
    ay = T + rMax + Math.max(0, tall - rMax) / 2
    top = ay - rMax
  } else {
    const MT = 26
    const MB = 28
    const lead = 22
    rMax = Math.max(40, Math.min((H - MT - MB) / (2 * sinA), W - lead - 12))
    ax = lead + Math.max(0, (W - lead - 12 - rMax) / 2)
    ay = MT + (H - MT - MB) / 2
  }
  const rho = at(rMax)
  const point = (r, t) => (upright
    ? { x: ax + r * Math.sin(t), y: ay - r * Math.cos(t) }
    : { x: ax + r * Math.cos(t), y: ay + r * Math.sin(t) })
  const arc = r => {
    const p = point(r, -a)
    const q = point(r, a)
    return `M${p.x} ${p.y}A${r} ${r} 0 0 1 ${q.x} ${q.y}`
  }
  const r0 = rho(D0)
  const rb = r0 * 0.55
  const edges = [-a, a].flatMap(t => {
    const p = point(12, t)
    const q = point(rb - 4, t)
    const u = point(rb + 4, t)
    const v = point(rMax, t)
    return [`M${p.x} ${p.y}L${q.x} ${q.y}`, `M${u.x} ${u.y}L${v.x} ${v.y}`]
  })
  // Two short slashes across each edge mark the cut between the circle and the nearest mark.
  const breaks = [-a, a].flatMap(t => [rb - 4, rb + 4].map(r => {
    const p = point(r, t)
    const n = upright ? { x: Math.cos(t), y: Math.sin(t) } : { x: -Math.sin(t), y: Math.cos(t) }
    return `M${p.x - n.x * 5 + 2} ${p.y - n.y * 5 - 2}L${p.x + n.x * 5 - 2} ${p.y + n.y * 5 + 2}`
  }))
  const zone = (() => {
    const p = point(r0, -a)
    const q = point(rMax, -a)
    const u = point(rMax, a)
    const v = point(r0, a)
    return `M${p.x} ${p.y}L${q.x} ${q.y}A${rMax} ${rMax} 0 0 1 ${u.x} ${u.y}L${v.x} ${v.y}A${r0} ${r0} 0 0 0 ${p.x} ${p.y}Z`
  })()
  const deco = [
    { kind: 'path', cls: 'zone', d: zone },
    ...edges.map(d => ({ kind: 'path', cls: 'edge', d })),
    ...breaks.map(d => ({ kind: 'path', cls: 'edge brk', d })),
  ]
  if (scene === 'javelin') {
    const arcR = 10
    const p = point(arcR, -1.1)
    const q = point(arcR, 1.1)
    deco.push({ kind: 'path', cls: 'ring', d: `M${p.x} ${p.y}A${arcR} ${arcR} 0 0 1 ${q.x} ${q.y}` })
    const back = upright ? H - ay : ax
    deco.push(...[-7, 7].map(o => ({
      kind: 'path',
      cls: 'edge',
      d: upright ? `M${ax + o} ${ay + 4}V${ay + back}` : `M${ax - 4} ${ay + o}H${ax - back}`,
    })))
  } else {
    deco.push({ kind: 'circle', cls: 'ring', cx: ax, cy: ay, r: 9 })
  }
  return {
    better: upright ? { x: 0, y: -1 } : { x: 1, y: 0 },
    maxS: d => rho(d) * a,
    scatter: true,
    pt: (d, s, nudge, rr) => {
      const r = rho(d) - nudge
      if (r <= rr + 12) return null
      const t = s / r
      if (Math.abs(t) > a - (rr + 2) / r) return null
      return point(r, t)
    },
    across: d => arc(rho(d)),
    lineLabel: (lines, textW2) => {
      const end = point(rho(lineV), -a)
      // Upright, the label sits inside the sector just above the arc's left end; the marks keep clear of it.
      const slope = Math.tan(a)
      return upright
        ? textBox(lines, end.x + 8 + 30 * slope, end.y - 25, 'start', textW2)
        : textBox([{ text: lines.map(line => line.text).join(' · '), bold: true, cls: 'a' }], end.x + 2, end.y - 8, 'end', textW2)
    },
    tag: d => {
      const end = point(rho(d), a)
      return upright ? { x0: end.x + 8, y0: end.y - 9 } : { x0: end.x - FIELD_TAG.w / 2, y0: end.y + 6 }
    },
    tick: d => {
      const end = point(rho(d), upright ? -a : a)
      return upright ? { x: end.x - 8, y: end.y + 5, anchor: 'end' } : { x: end.x, y: end.y + 19, anchor: 'middle' }
    },
    leaderSpot: upright ? { x: ax, y: top - 12, anchor: 'middle' } : { x: W - 2, y: 14, anchor: 'end' },
    readoutSpot: upright ? { x: ax, y: top - 12, anchor: 'middle' } : { x: 2, y: 14, anchor: 'start' },
    deco,
    length: rMax * (1 - share),
  }
}

// Two standards with the bar set at the line between them, on a landing mat. Heights run up the standards
// in either shape; places at one height spread along the bar.
function barGeo({ W, H, scene, D0, D1, tickW, lineW }) {
  const T = 30
  const B = 24
  const xl = tickW + 16
  const xr = W - Math.max(lineW, FIELD_TAG.w) - 16
  const yTop = T + 8
  const yBot = H - B - 8
  const y = d => yTop + (D1 - d) / (D1 - D0) * (yBot - yTop)
  const cx = (xl + xr) / 2
  const half = (xr - xl) / 2
  const deco = [
    { kind: 'rect', cls: 'mat', x: xl - 14, y: H - B, w: xr - xl + 28, h: B - 6, rx: 5 },
    { kind: 'rect', cls: 'standard', x: xl - 3, y: yTop - 14, w: 6, h: H - B - yTop + 14, rx: 2 },
    { kind: 'rect', cls: 'standard', x: xr - 3, y: yTop - 14, w: 6, h: H - B - yTop + 14, rx: 2 },
  ]
  if (scene === 'vault') {
    deco.push({ kind: 'path', cls: 'edge', d: `M${cx - 16} ${H - B}L${cx - 6} ${H - 4}H${cx + 6}L${cx + 16} ${H - B}` })
  }
  return {
    better: { x: 0, y: -1 },
    maxS: () => half,
    pt: (d, s, nudge, rr) => (Math.abs(s) > half - rr - 8 ? null : { x: cx + s, y: y(d) + nudge }),
    across: d => `M${xl} ${y(d)}H${xr}`,
    lineLabel: (lines, textW, lineV) => textBox(lines, xr + 10, y(lineV) - 3, 'start', textW),
    tag: d => ({ x0: xr + 9, y0: y(d) - 9 }),
    tick: d => ({ x: xl - 10, y: y(d) + 5, anchor: 'end' }),
    leaderSpot: { x: cx, y: 16, anchor: 'middle' },
    readoutSpot: { x: cx, y: 16, anchor: 'middle' },
    deco,
    length: yBot - yTop,
    tickGap: 30,
  }
}

// The runway and its board, cut short at the break, then the sand. Distance runs from the board into the
// pit; places with one mark spread across the sand.
function pitGeo({ W, H, upright, D0, D1, fieldV, tickW, lineW }) {
  if (upright) {
    const T = 30
    const B = 8
    let xl = tickW + 18
    let xr = W - Math.max(lineW, FIELD_TAG.w) - 20
    if (xr - xl > 240) {
      const spare = (xr - xl - 240) / 2
      xl += spare
      xr -= spare
    }
    const cx = (xl + xr) / 2
    const pitH = (H - T - B) * 0.76
    const yTop = T + 8
    const yBot = yTop + pitH
    const y = d => yTop + (D1 - d) / (D1 - D0) * pitH
    const rw = Math.min(54, (xr - xl) * 0.34)
    const yRun = yBot + 8
    const yBoard = yRun + (H - B - yRun) * 0.62
    const yBrk = (yRun + yBoard) / 2
    const deco = [
      { kind: 'rect', cls: 'runway', x: cx - rw / 2, y: yRun, w: rw, h: H - yRun },
      { kind: 'rect', cls: 'sand', x: xl, y: yTop - 8, w: xr - xl, h: yBot - yTop + 16, rx: 6 },
      ...[-rw / 2, rw / 2].flatMap(o => [
        { kind: 'path', cls: 'edge', d: `M${cx + o} ${yRun}V${yBrk - 5}` },
        { kind: 'path', cls: 'edge', d: `M${cx + o} ${yBrk + 5}V${H}` },
        { kind: 'path', cls: 'edge brk', d: `M${cx + o - 5} ${yBrk - 3}L${cx + o + 5} ${yBrk - 7}M${cx + o - 5} ${yBrk + 7}L${cx + o + 5} ${yBrk + 3}` },
      ]),
      { kind: 'rect', cls: 'board', x: cx - rw / 2, y: yBoard, w: rw, h: 6, rx: 1 },
    ]
    const half = (xr - xl) / 2
    return {
      better: { x: 0, y: -1 },
      maxS: () => half,
      scatter: true,
      pt: (d, s, nudge, rr) => (Math.abs(s) > half - rr - 5 ? null : { x: cx + s, y: y(d) + nudge }),
      across: d => `M${xl} ${y(d)}H${xr}`,
      lineLabel: (lines, textW, lineV) => textBox(lines, xr + 10, y(lineV) - 3, 'start', textW),
      tag: d => ({ x0: xr + 9, y0: y(d) - 9 }),
      tick: d => ({ x: xl - 10, y: y(d) + 5, anchor: 'end' }),
      leaderSpot: { x: cx, y: 16, anchor: 'middle' },
      readoutSpot: { x: cx, y: 16, anchor: 'middle' },
      deco,
      length: pitH,
    }
  }
  const T = 30
  const B = 24
  const yT = T
  const yB = H - B
  const cy = (yT + yB) / 2
  const xp0 = Math.max(78, W * 0.2)
  const xp1 = W - 10
  const x = d => xp0 + (d - D0) / (D1 - D0) * (xp1 - xp0)
  const rw = Math.min(54, (yB - yT) * 0.36)
  const xRun = xp0 - 8
  const xBoard = xRun * 0.38
  const xBrk = (xBoard + xRun) / 2
  const deco = [
    { kind: 'rect', cls: 'runway', x: 0, y: cy - rw / 2, w: xRun, h: rw },
    { kind: 'rect', cls: 'sand', x: xp0 - 8, y: yT, w: xp1 - xp0 + 16, h: yB - yT, rx: 6 },
    ...[-rw / 2, rw / 2].flatMap(o => [
      { kind: 'path', cls: 'edge', d: `M${xRun} ${cy + o}H${xBrk + 5}` },
      { kind: 'path', cls: 'edge', d: `M${xBrk - 5} ${cy + o}H0` },
      { kind: 'path', cls: 'edge brk', d: `M${xBrk - 7} ${cy + o + 5}L${xBrk - 3} ${cy + o - 5}M${xBrk + 3} ${cy + o + 5}L${xBrk + 7} ${cy + o - 5}` },
    ]),
    { kind: 'rect', cls: 'board', x: xBoard - 3, y: cy - rw / 2, w: 6, h: rw, rx: 1 },
  ]
  const half = (yB - yT) / 2
  return {
    better: { x: 1, y: 0 },
    maxS: () => half,
    scatter: true,
    pt: (d, s, nudge, rr) => (Math.abs(s) > half - rr - 5 ? null : { x: x(d) - nudge, y: cy + s }),
    across: d => `M${x(d)} ${yT}V${yB}`,
    lineLabel: (lines, textW, lineV) => {
      const text = [{ text: lines.map(line => line.text).join(' · '), bold: true, cls: 'a' }]
      // On the side of the line away from the field line, which takes the other.
      const left = textBox(text, x(lineV) - 6, yT - 9, 'end', textW)
      const right = textBox(text, x(lineV) + 6, yT - 9, 'start', textW)
      const order = fieldV != null && fieldV < lineV ? [right, left] : [left, right]
      return order.find(box => box.x0 >= 0 && box.x1 <= W) || left
    },
    tag: d => ({ x0: x(d) - FIELD_TAG.w - 6, y0: yT - 23, alt: x(d) + 6 }),
    tick: d => ({ x: x(d), y: H - 6, anchor: 'middle' }),
    leaderSpot: null,
    readoutSpot: { x: 2, y: 14, anchor: 'start' },
    deco,
    length: xp1 - xp0,
  }
}

// Where across the venue a mark lands, the same every time for the same athlete: a thrower or jumper is
// not always dead centre.
function lateral(name, rank) {
  let h = 2166136261
  for (const c of `${name}|${rank}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000 * 2 - 1
}

// Every dot at its own mark, the better place first. On a sector or in a pit each starts at its own place
// across the venue; on a bar, places at one height fill it from the middle. A place that would touch one
// already drawn, or a label in `avoid`, moves across the venue a step at a time on alternate sides; with no
// room left across it, it drops a little toward the shorter side and tries again.
function placeDots(points, geo, { radius: r, chipR, avoid = [] }) {
  const placed = []
  points.forEach(point => {
    const rr = point.rank === 1 ? chipR : r
    const clear = p => placed.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= q.rr + rr + 1)
      && avoid.every(box => p.x + rr + 2 < box.x0 || p.x - rr - 2 > box.x1 || p.y + rr + 2 < box.y0 || p.y - rr - 2 > box.y1)
    const pitch = 2 * r + 2
    const reach = geo.maxS(point.v)
    const start = geo.scatter ? lateral(point.name, point.rank) * reach * 0.7 : 0
    let spot = null
    for (let k = 0; k < 120 && !spot; k += 1) {
      const nudge = k * r * 0.7
      for (let i = 0; i < 2 * reach / pitch + 4; i += 1) {
        const s = start + (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * pitch)
        if (Math.abs(s) > reach) continue
        const p = geo.pt(point.v, s, nudge, rr)
        if (p && clear(p)) {
          spot = p
          break
        }
      }
    }
    spot = spot || geo.pt(point.v, 0, 0, rr) || { x: 0, y: 0 }
    placed.push({ ...point, x: spot.x, y: spot.y, rr })
  })
  return placed
}

export function layoutScene({
  scene,
  rows,
  lineV,
  rank,
  fieldRank = null,
  scale,
  width: W,
  height: H,
  upright = false,
  radius = 5,
  chipR = 12,
  measure = null,
  listed = rows.length,
}) {
  const usable = rows.filter(row => Number.isFinite(row.v) && row.v > 0)
  if (!scene || !scale || !usable.length || !Number.isFinite(lineV) || !(W > 0) || !(H > 0)) return null
  const textW = (text, bold = false) => (measure ? measure(text, bold) : estimateWidth(text))
  const marks = usable.map(row => row.v)
  const lo = Math.min(lineV, ...marks)
  const hi = Math.max(lineV, ...marks)
  const pad = Math.max((hi - lo) * 0.06, 0.03)
  const D0 = lo - pad
  const D1 = hi + pad

  const deepest = fieldRank != null ? usable.find(row => row.rank === fieldRank) : null
  const next = deepest ? usable.find(row => row.rank === fieldRank + 1) : null
  const fieldV = deepest ? (next ? (deepest.v + next.v) / 2 : deepest.v - pad / 2) : null

  const lineMark = formatMark(lineV, 'mark')
  const lineLines = [{ text: 'Qualifying line', bold: true, cls: 'a' }, { text: lineMark, bold: true, cls: 'k' }]
  const lineW = Math.max(...lineLines.map(line => textW(line.text, true)))
  // Distances in whole steps, about one every 70px along the venue.
  const tickText = (v, digits) => `${v.toFixed(digits)}\u2009m`
  const tickW = textW(tickText(hi, hi - lo < 1 ? 2 : 1)) + 2
  const bar = scene === 'bar' || scene === 'vault'
  const geo = bar
    ? barGeo({ W, H, scene, D0, D1, tickW, lineW })
    : scene === 'pit'
      ? pitGeo({ W, H, upright, D0, D1, fieldV, tickW, lineW })
      : sectorGeo({ W, H, upright, scene, D0, D1, lineV, fieldV, tickW })

  const lineLabel = geo.lineLabel(lineLines, textW, lineV)
  const points = usable.map(row => ({ ...row, m: row.v - lineV })).sort((a, b) => a.rank - b.rank)
  const placed = placeDots(points, geo, { radius, chipR, avoid: [lineLabel] })
  let field = null
  if (fieldV != null) {
    const spot = geo.tag(fieldV)
    const away = fieldV < lineV ? { x: -geo.better.x, y: -geo.better.y } : geo.better
    const box = (x0, y0) => ({ x0, y0, x1: x0 + FIELD_TAG.w, y1: y0 + FIELD_TAG.h })
    let tag = box(spot.x0, spot.y0)
    if (meet(tag, lineLabel, 4) && spot.alt != null) tag = box(spot.alt, spot.y0)
    for (let k = 1; k < 200 && meet(tag, lineLabel, 4); k += 1) tag = box(spot.x0 + away.x * k * 2, spot.y0 + away.y * k * 2)
    tag = box(Math.min(Math.max(tag.x0, 0), W - FIELD_TAG.w), Math.min(Math.max(tag.y0, 0), H - FIELD_TAG.h))
    field = { v: fieldV, path: geo.across(fieldV), tag, rank: fieldRank }
  }

  const maxTicks = Math.max(2, Math.floor(geo.length / (geo.tickGap || 48)))
  const step = STEPS.find(s => (D1 - D0) / s <= maxTicks) || STEPS.at(-1)
  const digits = stepDigits(step)
  const ticks = []
  const taken = [lineLabel, field?.tag].filter(Boolean)
  const lineAt = geo.tick(lineV)
  for (let v = Math.ceil(D0 / step - 1e-9) * step; v <= D1 + 1e-9; v += step) {
    const spot = geo.tick(v)
    const text = tickText(v, digits)
    const box = textBox([{ text }], spot.x, spot.y, spot.anchor, textW)
    if (Math.hypot(spot.x - lineAt.x, spot.y - lineAt.y) < 16) continue
    if (taken.some(other => meet(box, other, 4)) || ticks.some(other => meet(box, other.box, 6))) continue
    if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H) continue
    ticks.push({ v, path: geo.across(v), text, ...spot, box })
  }

  const leader = placed.find(dot => dot.rank === 1)
  let leaderLabel = null
  if (leader && leader.rank !== rank && geo.leaderSpot) {
    const gap = `${formatMeters(leader.m, scale.digits)} ${scale.ahead}`
    const name = familyName(leader.name)
    const forms = [name && `${name}, 1st · ${gap}`, `1st · ${gap}`].filter(Boolean)
    for (const text of forms) {
      const box = textBox([{ text, bold: true, cls: 'k' }], geo.leaderSpot.x, geo.leaderSpot.y, geo.leaderSpot.anchor, textW)
      if (box.x0 >= 0 && box.x1 <= W && !taken.some(other => meet(box, other, 6))) {
        leaderLabel = box
        break
      }
    }
  }

  const firstOut = placed.find(dot => dot.rank === rank + 1)
  const venue = bar
    ? `against a bar set at the line, ${lineMark}, higher at the top`
    : scene === 'pit'
      ? `in the sand pit, the line drawn across it at ${lineMark}`
      : `on the landing sector, the line drawn as an arc at ${lineMark}`
  const aria = [
    `The top ${topWords(rows.length, listed)} ${venue}.`,
    leader && leader.rank !== rank ? `${familyName(leader.name) || '1st'} is ${formatMeters(leader.m, scale.digits)} ${scale.beyond} the line.` : '',
    firstOut ? `The first one out is ${formatMeters(firstOut.m, scale.digits)} ${scale.back}.` : '',
  ].filter(Boolean).join(' ')

  return {
    scene, width: W, height: H, upright, radius, chipR, lineV, scale, textW,
    deco: geo.deco, line: { path: geo.across(lineV), label: lineLabel }, field, ticks, placed, leaderLabel,
    readoutSpot: geo.readoutSpot, aria,
  }
}

// The one line for the place being pointed at: "14. Endrody · 19.32 m · 0.19 m short", fitted inside the
// picture by shortening the name, then leaving out the gap and the mark.
export function sceneReadout(layout, dot, lineRank) {
  const { scale, readoutSpot: spot, width, textW } = layout
  const mark = formatMark(dot.v, 'mark')
  const tail = ` · ${dot.rank === lineRank ? 'on the line' : `${formatMeters(dot.m, scale.digits)} ${dot.m > 0 ? scale.ahead : scale.back}`}`
  const head = name => `${dot.rank}. ${name}`
  const parts = (name, keep) => `${head(name)}${keep.mark ? ` · ${mark}` : ''}${keep.tail ? tail : ''}`
  const names = readoutNames(dot.name)
  const fit = fitReadout({
    x: spot.x, width, names: names.length ? names : [`Place ${dot.rank}`], parts, measure: text => textW(text, true),
  })
  const anchor = spot.anchor === 'middle' ? fit.anchor : spot.anchor
  return { x: fit.x, y: spot.y, anchor, text: parts(fit.name, fit), place: ordinal(dot.rank) }
}
