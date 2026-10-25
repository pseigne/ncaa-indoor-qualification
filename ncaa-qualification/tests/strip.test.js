import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { eventMeta, hasStrip } from '../src/utils/catalog'
import { markInfo } from '../src/utils/format'
import {
  GROUP_GAP, LANE_GAP, LANE_ORDER, fieldScale, groupByHeight, laneDepth, placeDots, layoutColumn, layoutStrip, metersAhead, placeReadout, scaleFor, wrapLine,
} from '../src/utils/strip'

function field(count, valueAt) {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    name: `Runner, ${String.fromCharCode(65 + (index % 26))}${index}`,
    v: valueAt(index),
  }))
}

function overlapsLine(label, lineX) {
  return label.x0 < lineX + 4 && label.x1 > lineX - 4
}

describe('race strip labels', () => {
  it('keeps meters on the strip and off the qualifying line', () => {
    const rows = field(20, index => 230 + index * 0.4)
    const lineV = rows[15].v
    const layout = layoutStrip({ rows, lineV, dist: 1609.34, rank: 16, width: 960, radius: 8 })
    expect(metersAhead(1609.34, lineV, rows[0].v)).toBeGreaterThan(0)
    expect(layout.placed.find(dot => dot.rank === 16).m).toBeCloseTo(0, 6)
    expect(layout.xAt(1) - layout.xAt(0)).toBeCloseTo(layout.xAt(0) - layout.xAt(-1), 5)
    const line = layout.labels.find(label => label.cls === 'a')
    expect(line.text).toMatch(/^Qualifying line/)
    for (const label of layout.labels) {
      if (label.cls === 'a') continue
      expect(overlapsLine(label, layout.lineX)).toBe(false)
    }
  })

  it('shortens a label that would cross the line, then drops it', () => {
    const rows = [
      { rank: 1, name: 'Leader, Ada', v: 230 },
      { rank: 16, name: 'Line, Bea', v: 240 },
      { rank: 17, name: 'Outsider, Verylongfirstname', v: 242 },
    ]
    const layout = layoutStrip({ rows, lineV: 240, dist: 1609.34, rank: 16, width: 960, radius: 8 })
    const outside = layout.labels.find(label => label.rank === 17)
    expect(outside).toBeTruthy()
    expect(outside.text.startsWith('17th')).toBe(true)
    expect(outside.text).not.toMatch(/first one out/)
    expect(overlapsLine(outside, layout.lineX)).toBe(false)

    const near = [
      { rank: 1, name: 'Leader, Ada', v: 50 },
      { rank: 16, name: 'Line, Bea', v: 50.01 },
      { rank: 17, name: 'Outsider, Verylongfirstname', v: 50.02 },
    ]
    const cramped = layoutStrip({ rows: near, lineV: 50.01, dist: 400, rank: 16, width: 220, radius: 8 })
    expect(cramped.xAt(1) - cramped.xAt(0)).toBeCloseTo(cramped.xAt(0) - cramped.xAt(-1), 5)
    const crampedOut = cramped.labels.find(label => label.rank === 17)
    expect(crampedOut).toBeTruthy()
    expect(crampedOut.text.startsWith('17th')).toBe(true)
    expect(overlapsLine(crampedOut, cramped.lineX)).toBe(false)
    expect(cramped.labels.some(label => label.cls === 'a')).toBe(true)

    const dropped = layoutStrip({ rows: near, lineV: 50.01, dist: 400, rank: 16, width: 120, radius: 8 })
    expect(dropped.xAt(1) - dropped.xAt(0)).toBeCloseTo(dropped.xAt(0) - dropped.xAt(-1), 5)
    expect(dropped.labels.some(label => label.rank === 17)).toBe(false)
    // 120px leaves room for "Qualifying line" on neither side of the line, so it is left out rather
    // than drawn across the line.
    expect(dropped.labels.some(label => label.cls === 'a')).toBe(false)
    expect(dropped.labels.every(label => !overlapsLine(label, dropped.lineX))).toBe(true)
  })

  it('puts the line label left of the line, 6px from it, when it does not fit on the right', () => {
    // A relay field with the line close to the right edge, as on the men's DMR phone strip.
    const rows = Array.from({ length: 50 }, (_, index) => ({ rank: index + 1, name: `Team ${index + 1}`, v: index < 12 ? 554 + index * 0.4 : 565 + index }))
    const phone = layoutStrip({ rows, lineV: rows[11].v, dist: 1609.34 * 2.5, rank: 12, width: 358, radius: 4.5, phone: true })
    const line = phone.labels.find(label => label.cls === 'a')
    expect(phone.width - phone.lineX).toBeLessThan(8 + 'Qualifying line'.length * 7.2)
    expect(line.anchor).toBe('end')
    expect(line.x1).toBeCloseTo(phone.lineX - 6, 6)
    expect(line.x0).toBeGreaterThanOrEqual(0)
    expect(overlapsLine(line, phone.lineX)).toBe(false)
    // With room on the right it stays there, starting 8px past the line.
    const roomy = layoutStrip({ rows, lineV: rows[11].v, dist: 1609.34 * 2.5, rank: 12, width: 358, radius: 4.5, phone: true, domain: [-120, 120] })
    const right = roomy.labels.find(label => label.cls === 'a')
    expect(right.anchor).toBe('start')
    expect(right.x0).toBeCloseTo(roomy.lineX + 8, 6)
    expect(overlapsLine(right, roomy.lineX)).toBe(false)
  })

  it('puts a last-place label that is behind the line into the space behind it', () => {
    const rows = [
      { rank: 1, name: 'Leader, Ada', v: 9.8 },
      { rank: 48, name: 'Line, Calhoun', v: 10.1 },
      { rank: 49, name: 'Tie, Bea', v: 10.1 },
      { rank: 51, name: 'Last, Dee', v: 10.11 },
    ]
    const layout = layoutStrip({ rows, lineV: 10.1, dist: 100, rank: 48, width: 960, radius: 8 })
    const last = layout.labels.find(label => label.rank === 51)
    expect(last.text).toMatch(/^51st, .* back$/)
    expect(last.anchor).toBe('end')
    expect(overlapsLine(last, layout.lineX)).toBe(false)
    expect(last.x0).toBeGreaterThanOrEqual(0)
    expect(last.x1).toBeLessThanOrEqual(layout.width)
    const phone = layoutStrip({ rows, lineV: 10.1, dist: 100, rank: 48, width: 358, radius: 4.5, phone: true })
    for (const label of phone.labels) {
      expect(label.x0).toBeGreaterThanOrEqual(0)
      expect(label.x1).toBeLessThanOrEqual(phone.width)
      if (label.cls !== 'a') expect(overlapsLine(label, phone.lineX)).toBe(false)
    }
  })

  it('does not let a leader run through another label or a tie stack', () => {
    const rows = field(12, index => (index < 8 ? 6.5 : 6.5 + (index - 7) * 0.04))
    const layout = layoutStrip({ rows, lineV: rows[7].v, dist: 60, rank: 8, width: 960, radius: 8 })
    expect(layout.kMax).toBeGreaterThanOrEqual(7)
    for (const label of layout.labels) {
      if (!label.leader) continue
      for (const other of layout.labels) {
        if (other === label) continue
        const through = label.leader.x1 > other.x0 + 4 && label.leader.x1 < other.x1 - 4
        expect(through).toBe(false)
      }
      const stack = layout.placed.filter(dot => Math.abs(dot.x - label.leader.x1) < 16)
      const top = Math.min(...stack.map(dot => dot.y))
      expect(label.leader.y2).toBeCloseTo(top - layout.radius - 3, 5)
      expect(label.leader.y2).toBeLessThan(top - layout.radius)
    }
  })

  it('draws a neutral lane for every stacked row, including a 60m tie stack', () => {
    const rows = field(16, () => 6.51)
    const layout = layoutStrip({ rows, lineV: 6.51, dist: 60, rank: 16, width: 960, radius: 8 })
    expect(layout.kMax).toBe(15)
    expect(layout.lanes).toHaveLength(layout.kMax + 2)
    for (const lane of layout.lanes) {
      expect(lane.y).toEqual(lane.y)
      expect(lane.x1).toBe(0)
      expect(lane.x2).toBe(layout.width)
    }
    const phone = layoutStrip({ rows, lineV: 6.51, dist: 60, rank: 16, width: 358, radius: 4.5, phone: true })
    expect(phone.labels.some(label => label.cls === 'a')).toBe(true)
    expect(phone.labels.filter(label => label.cls !== 'a').every(label => label.rank === 1)).toBe(true)
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/\.race \.lane\{stroke:var\(--rule\)/)
    expect(css).toMatch(/\.race \.fl line\{stroke:var\(--line\)/)
    expect(css).not.toMatch(/\.lane\{[^}]*--line/)
    expect(css).not.toMatch(/loupe/)
  })
})

// No two dots touch, and two dots in one lane sit at least LANE_GAP apart.
function expectApart(layout) {
  const dots = layout.placed
  dots.forEach((dot, index) => dots.slice(index + 1).forEach(other => {
    expect(Math.hypot(dot.x - other.x, dot.y - other.y)).toBeGreaterThanOrEqual(2 * layout.radius)
    if (dot.lane === other.lane) expect(Math.abs(dot.y - other.y)).toBeGreaterThanOrEqual(LANE_GAP)
  }))
}

function toSegment([x, y], [x1, y1], [x2, y2]) {
  const length = (x2 - x1) ** 2 + (y2 - y1) ** 2
  const t = length ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / length)) : 0
  return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)))
}

// A leader may only touch its own dot.
function expectLeaderClear(layout, points, own) {
  for (const dot of layout.placed) {
    if (dot === own) continue
    points.slice(1).forEach((point, index) => {
      expect(toSegment([dot.x, dot.y], points[index], point)).toBeGreaterThan(layout.radius)
    })
  }
}

const saved = JSON.parse(readFileSync(join(process.cwd(), '../data/site/indoor-2025-2026-m-National.json'), 'utf8'))
function savedEvent(event) {
  const record = saved.events.find(item => item.event === event)
  const rows = record.rankings.map(row => ({ rank: row.rank, name: row.team && /Relay/.test(event) ? row.team : row.athlete, v: markInfo(row.time).v }))
  const rank = record.qualification.rank
  return { rows, rank, lineV: rows.find(row => row.rank === rank).v, dist: /Medley/.test(event) ? 4000 : 1609.34 }
}

describe('upright race column on the saved DMR and mile', () => {
  for (const event of ['Distance Medley Relay', 'Mile']) {
    for (const [width, minPitch] of [[398, 16], [340, 14]]) {
      it(`${event} at ${width}px: no dots touch, lanes keep 16px, and leaders clear every other dot`, () => {
        const { rows, rank, lineV, dist } = savedEvent(event)
        const layout = layoutColumn({ rows, lineV, dist, rank, width, height: 735, bottom: 52, minPitch, charWidth: 6.7 })
        expectApart(layout)
        for (const label of layout.labels) {
          expectLeaderClear(layout, label.leader.points, layout.placed.find(dot => dot.rank === label.rank))
        }
        for (const dot of layout.placed) {
          const readout = placeReadout(layout, dot, 'time', rank)
          if (readout.leader) expectLeaderClear(layout, readout.leader.points, dot)
        }
      })
    }
  }
})

describe('upright race column', () => {
  const dmr = Array.from({ length: 50 }, (_, index) => ({
    rank: index + 1,
    name: index === 11 ? 'Colorado' : `School ${index + 1}`,
    v: 554.8 + index * 0.49,
  }))

  it('runs ahead at the top, behind at the bottom, and fits the whole field in the column', () => {
    const layout = layoutColumn({ rows: dmr, lineV: dmr[11].v, dist: 4000, rank: 12, width: 400, height: 760, bottom: 52 })
    const first = layout.placed.find(dot => dot.rank === 1)
    const last = layout.placed.find(dot => dot.rank === 50)
    expect(first.y).toBeLessThan(layout.lineY)
    expect(last.y).toBeGreaterThan(layout.lineY)
    expect(layout.placed.find(dot => dot.rank === 12).y).toBeCloseTo(layout.lineY, 6)
    expect(layout.yAt(1) - layout.yAt(0)).toBeCloseTo(layout.yAt(0) - layout.yAt(-1), 5)
    expect(layout.placed).toHaveLength(50)
    for (const dot of layout.placed) {
      expect(dot.y - layout.radius).toBeGreaterThanOrEqual(0)
      expect(dot.y + layout.radius).toBeLessThanOrEqual(layout.height - layout.bottom)
      expect(dot.x - layout.radius).toBeGreaterThanOrEqual(layout.gutter)
      expect(dot.x + layout.radius).toBeLessThanOrEqual(layout.width)
    }
  })

  it('labels the line from the data and keeps meter ticks on nice steps in the left gutter', () => {
    const layout = layoutColumn({ rows: dmr, lineV: dmr[11].v, dist: 4000, rank: 12, width: 400, height: 760, bottom: 52 })
    expect(layout.lineLabel.lines.join(' · ')).toBe('Qualifying line · Colorado, 12th')
    expect(layout.lineLabel.x1).toBeLessThanOrEqual(layout.width)
    expect([0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100]).toContain(layout.step)
    expect(layout.ticks.length).toBeGreaterThan(2)
    for (const tick of layout.ticks) {
      const meters = Number(tick.text.split('\u2009')[0])
      expect(meters / layout.step).toBeCloseTo(Math.round(meters / layout.step), 6)
      expect(tick.text).toMatch(tick.y < layout.lineY ? / ahead$/ : / behind$/)
      expect(tick.text.length * layout.charWidth).toBeLessThan(layout.gutter)
    }
    for (const label of layout.labels) {
      expect(label.x0).toBeGreaterThanOrEqual(layout.gutter)
      expect(label.x1).toBeLessThanOrEqual(layout.width)
    }
  })

  const wide = () => layoutColumn({ rows: dmr, lineV: dmr[11].v, dist: 4000, rank: 12, width: 366, height: 760, bottom: 52 })
  const centresOf = layout => layout.lanes.slice(1).map((lane, index) => (lane.x + layout.lanes[index].x) / 2)

  it('spreads eight even lanes between nine lines, between the meter gutter and the label gutter', () => {
    const layout = wide()
    expect(layout.radius).toBe(5)
    expect(layout.lanes).toHaveLength(9)
    const xs = layout.lanes.map(lane => lane.x)
    expect(xs[0]).toBeCloseTo(layout.gutter + 16, 6)
    expect(xs[8]).toBeCloseTo(layout.width - layout.labelGutter - 16, 6)
    expect(layout.labelGutter).toBeGreaterThan(0)
    expect(layout.pitch).toBeGreaterThanOrEqual(2 * layout.radius + 2)
    xs.slice(1).forEach((x, index) => expect(x - xs[index]).toBeCloseTo(layout.pitch, 6))
    for (const lane of layout.lanes) {
      expect(lane.y1).toBe(0)
      expect(lane.y2).toBe(layout.height - layout.bottom)
    }
    const centres = centresOf(layout)
    for (const dot of layout.placed.filter(q => q.tier === 0)) expect(dot.x).toBeCloseTo(centres[dot.lane - 1], 6)
    expect(layout.laneFrom).toBeCloseTo(xs[0], 6)
    expect(layout.laneTo).toBeCloseTo(xs[8], 6)
  })

  it('groups dots that sit within 16px of the next, one after another', () => {
    const at = (rank, y) => ({ rank, y })
    const groups = groupByHeight([at(4, 32), at(1, 0), at(9, 60), at(2, 16), at(7, 49), at(3, 90)])
    expect(groups.map(group => group.map(point => point.rank))).toEqual([[1, 2, 4], [7, 9], [3]])
    expect(GROUP_GAP).toBe(16)
    expect(groupByHeight([at(1, 0), at(2, 16)])).toHaveLength(1)
    expect(groupByHeight([at(1, 0), at(2, 16.5)])).toHaveLength(2)
  })

  it('fills a group from the middle lanes out, best place first, keeping every height', () => {
    expect(LANE_ORDER).toEqual([4, 5, 3, 6, 2, 7, 1, 8])
    const near = Array.from({ length: 6 }, (_, index) => ({ rank: index + 1, name: `School ${index + 1}`, v: 600 + index * 0.02 }))
    const far = [{ rank: 7, name: 'School 7', v: 640 }]
    const layout = layoutColumn({ rows: [...near, ...far], lineV: 600.1, dist: 4000, rank: 6, width: 366, height: 700 })
    const centres = centresOf(layout)
    const lanes = layout.placed.slice(0, 6).map(dot => dot.lane)
    expect(lanes).toEqual([4, 5, 3, 6, 2, 7])
    for (const dot of layout.placed) {
      expect(dot.y).toBe(layout.yAt(dot.m))
      expect(dot.x).toBeCloseTo(centres[dot.lane - 1], 6)
    }
    expect(layout.placed[6].lane).toBe(4)
  })

  it('never gives a better place a less central lane than a worse place in its group', () => {
    const crowd = field(40, index => 230 + index * 0.05)
    const mile = field(50, index => 231.73 + index * 0.107)
    for (const [rows, dist, width, height] of [
      [dmr, 4000, 398, 760], [dmr, 4000, 340, 620], [crowd, 1609.34, 340, 640], [mile, 1609.34, 398, 760], [field(20, () => 6.51), 60, 398, 600],
    ]) {
      const layout = layoutColumn({ rows, lineV: rows[11].v, dist, rank: 12, width, height, bottom: 52, minPitch: width < 398 ? 14 : 16, charWidth: 6.7 })
      const groups = new Map()
      layout.placed.forEach(dot => groups.set(dot.group, [...(groups.get(dot.group) || []), dot]))
      for (const group of groups.values()) {
        const byPlace = [...group].sort((a, b) => a.rank - b.rank)
        const first = byPlace.slice(0, 8)
        first.slice(1).forEach((dot, index) => expect(laneDepth(dot.lane)).toBeGreaterThanOrEqual(laneDepth(first[index].lane)))
        first.forEach((dot, index) => expect(laneDepth(dot.lane)).toBe(Math.floor(index / 2)))
      }
    }
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(laneDepth)).toEqual([3, 2, 1, 0, 0, 1, 2, 3])
  })

  it('sends place 9 onward to the outside lanes first, then inward, at its own height', () => {
    const laneX = lane => lane * 20
    const spread = Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, y: index * 14 }))
    const dots = placeDots([spread], { radius: 5, laneX })
    expect(dots.map(dot => dot.lane)).toEqual([...LANE_ORDER, 1, 8])
    dots.forEach((dot, index) => expect(dot.y).toBe(spread[index].y))
    const packed = Array.from({ length: 11 }, (_, index) => ({ rank: index + 1, y: index * 3 }))
    const inward = placeDots([packed], { radius: 5, laneX })
    expect(inward.slice(8).map(dot => dot.lane)).toEqual([3, 6, 2])
    expect(inward.every(dot => !dot.offset)).toBe(true)
  })

  it('moves a tie half a dot over and down only to a spot that touches nothing', () => {
    const ties = field(12, () => 6.51)
    const layout = layoutColumn({ rows: ties, lineV: 6.51, dist: 60, rank: 12, width: 360, height: 600 })
    const centres = centresOf(layout)
    const first = layout.placed.slice(0, 8)
    expect(new Set(first.map(dot => dot.y)).size).toBe(1)
    first.forEach((dot, index) => expect(laneDepth(dot.lane)).toBe(Math.floor(index / 2)))
    const rest = layout.placed.slice(8)
    for (const dot of rest) {
      expect(dot.offset).toBe(true)
      expect(dot.y).toBeGreaterThan(first[0].y)
      expect(Math.abs(dot.x - centres[dot.lane - 1])).toBeCloseTo(layout.radius, 6)
    }
    expectApart(layout)
  })

  it('labels the leader, first one out and last runner in the right gutter, each with a leader line', () => {
    const layout = wide()
    expect(layout.lineLabel.lines).toEqual(['Qualifying line', 'Colorado, 12th'])
    expect(layout.lineLabel.anchor).toBe('end')
    expect(layout.lineLabel.x1).toBe(layout.width)
    expect(layout.lineLabel.y1).toBeLessThanOrEqual(layout.lineY)
    expect(layout.labels.map(label => label.rank)).toEqual([1, 13, 50])
    const text = place => layout.labels.find(label => label.rank === place).lines
    expect(text(1)).toEqual(['School 1, 1st', expect.stringMatching(/^[\d.]+\u2009m\u00a0ahead$/)])
    expect(text(13)).toEqual(['First one out', 'School 13, 13th'])
    expect(text(50)).toEqual(['School 50, 50th', expect.stringMatching(/^[\d.]+\u2009m\u00a0back$/)])
    for (const label of layout.labels) {
      const dot = layout.placed.find(q => q.rank === label.rank)
      expect(label.anchor).toBe('end')
      expect(label.x1).toBe(layout.width)
      expect(label.x0).toBeGreaterThanOrEqual(layout.laneTo + 2 - 1e-6)
      const [start, end] = [label.leader.points[0], label.leader.points.at(-1)]
      expect(start[0]).toBeCloseTo(dot.x + layout.radius + 1, 6)
      expect(start[1]).toBe(dot.y)
      expect(end[0]).toBeCloseTo(label.x0 - 4, 6)
    }
  })

  it('keeps gutter labels to two lines and lanes at least the minimum pitch at both widths', () => {
    const relay = dmr.map(row => (row.rank === 13 ? { ...row, name: 'Texas A&M' } : row.rank === 50 ? { ...row, name: 'Oregon (B)' } : row))
    // 6.7px is about the page font's average character; the page itself measures each label.
    for (const [width, minPitch] of [[398, 16], [340, 14]]) {
      const layout = layoutColumn({ rows: relay, lineV: relay[11].v, dist: 4000, rank: 12, width, height: 760, bottom: 52, minPitch, charWidth: 6.7 })
      expect(layout.pitch).toBeGreaterThanOrEqual(minPitch)
      for (const label of layout.labels) expect(label.lines.length).toBeLessThanOrEqual(2)
      expect(layout.labels.find(label => label.rank === 13).lines).toEqual(['First one out', 'Texas A&M, 13th'])
    }
  })

  it('drops a relay letter in the gutter only when the label would not fit, and keeps it on hover', () => {
    const relay = dmr.map(row => (row.rank === 50 ? { ...row, name: 'Oregon (B)' } : row))
    const roomy = layoutColumn({ rows: relay, lineV: relay[11].v, dist: 4000, rank: 12, width: 420, height: 760, bottom: 52, minPitch: 16 })
    expect(roomy.labels.find(label => label.rank === 50).lines[0]).toBe('Oregon (B), 50th')
    const tight = layoutColumn({ rows: relay, lineV: relay[11].v, dist: 4000, rank: 12, width: 340, height: 760, bottom: 52, minPitch: 14 })
    const last = tight.labels.find(label => label.rank === 50)
    expect(last.lines).toEqual(['Oregon, 50th', expect.stringMatching(/m\u00a0back$/)])
    const hover = placeReadout(tight, tight.placed.find(dot => dot.rank === 50), 'time', 12)
    expect(hover.lines[0].text).toBe('50. Oregon (B)')
  })

  it('never lets a label cover a dot or another label', () => {
    const meet = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
    const crowd = field(40, index => 230 + index * 0.05)
    // The strip is 398px at 1440 and 340px at 1280, with lanes at least 16px and 14px.
    for (const [rows, dist, width, height, minPitch] of [[dmr, 4000, 398, 760, 16], [dmr, 4000, 340, 760, 14], [crowd, 1609.34, 340, 640, 14]]) {
      const lineV = rows[11].v
      const layout = layoutColumn({ rows, lineV, dist, rank: 12, width, height, bottom: 52, minPitch, charWidth: 6.7 })
      const r = layout.radius
      const boxes = [layout.lineLabel, ...layout.labels]
      boxes.forEach((box, index) => {
        for (const dot of layout.placed) {
          expect(meet(box, { x0: dot.x - r, x1: dot.x + r, y0: dot.y - r, y1: dot.y + r })).toBe(false)
        }
        boxes.slice(index + 1).forEach(other => expect(meet(box, other)).toBe(false))
      })
    }
  })

  it('keeps every hover label clear of the qualifying label', () => {
    const meet = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
    const crowd = field(40, index => 230 + index * 0.05)
    for (const [rows, dist, width, height] of [[dmr, 4000, 366, 760], [dmr, 4000, 308, 760], [crowd, 1609.34, 308, 640]]) {
      const layout = layoutColumn({ rows, lineV: rows[11].v, dist, rank: 12, width, height, bottom: 52 })
      for (const dot of layout.placed) {
        const readout = placeReadout(layout, dot, 'time', 12)
        const box = { x0: readout.x0, x1: readout.x1, y0: readout.y - 13, y1: readout.y - 13 + readout.lines.length * 17 }
        expect(meet(box, layout.lineLabel)).toBe(false)
        expect(readout).not.toHaveProperty('covers')
      }
    }
  })

  it('breaks a label onto more lines instead of dropping the name', () => {
    const crowd = dmr.map(row => (row.rank === 13 ? { ...row, name: 'Northern Arizona State', v: dmr[11].v + 0.05 } : row))
    for (const width of [366, 330, 300]) {
      const layout = layoutColumn({ rows: crowd, lineV: crowd[11].v, dist: 4000, rank: 12, width, height: 700, bottom: 52, minPitch: 14 })
      const out = layout.labels.find(label => label.rank === 13)
      expect(out.lines.join(' ')).toBe('First one out Northern Arizona State, 13th')
      expect(out.x1).toBe(layout.width)
    }
    const width = text => text.length * 7
    expect(wrapLine('Texas A&M, 13th · 16.5 m back', 120, width)).toEqual(['Texas A&M, 13th', '16.5 m back'])
    expect(wrapLine('Texas A&M, 13th · 16.5 m back', 300, width)).toEqual(['Texas A&M, 13th · 16.5 m back'])
    expect(wrapLine('Northern Arizona State, 13th', 100, width).join(' ')).toBe('Northern Arizona State, 13th')
  })
})

describe('which events get a strip', () => {
  it('includes sprints, relays, jumps and throws, and leaves the combined events as tables', () => {
    expect(hasStrip(eventMeta('60 Meters'))).toBe(true)
    expect(hasStrip(eventMeta('Mile'))).toBe(true)
    expect(hasStrip(eventMeta('4 x 400 Relay'))).toBe(true)
    expect(hasStrip(eventMeta('Distance Medley Relay'))).toBe(true)
    expect(hasStrip(eventMeta('High Jump'))).toBe(true)
    expect(hasStrip(eventMeta('Weight Throw'))).toBe(true)
    expect(hasStrip(eventMeta('Javelin'))).toBe(true)
    expect(hasStrip(eventMeta('Heptathlon'))).toBe(false)
    expect(hasStrip(eventMeta('Pentathlon'))).toBe(false)
    expect(hasStrip(eventMeta('Decathlon'))).toBe(false)
  })
})

describe('jumps and throws on the strip', () => {
  const shot = Array.from({ length: 40 }, (_, index) => ({ rank: index + 1, name: `Thrower ${index + 1}`, v: 21 - index * 0.05 }))

  it('measures each mark from the line in meters, with no estimate', () => {
    const scale = scaleFor({ kind: 'mark', name: 'Shot Put' })
    expect(scale.gap(19.5, 20.1)).toBeCloseTo(0.6, 9)
    expect(scale.estimate).toBe(false)
    expect(scaleFor({ kind: 'points', name: 'Heptathlon' })).toBeNull()
    expect(scaleFor({ kind: 'time', dist: 400 }).gap(46, 45)).toBeCloseTo(metersAhead(400, 46, 45), 9)
  })

  it('says farther and shorter for a throw, higher and lower for a vertical jump', () => {
    const layout = layoutColumn({ rows: shot, lineV: shot[15].v, scale: fieldScale('Shot Put'), rank: 16, width: 400, height: 760, bottom: 52 })
    expect(layout.ticks.some(tick => tick.text.endsWith('farther'))).toBe(true)
    expect(layout.ticks.some(tick => tick.text.endsWith('shorter'))).toBe(true)
    expect(layout.aria).not.toMatch(/estimate/)
    const first = layout.labels.find(label => label.rank === 1)
    expect(first.lines.join(' ')).toMatch(/0\.75\u2009m\u00a0farther/)
    const vault = layoutStrip({ rows: shot.map(row => ({ ...row, v: row.v / 4 })), lineV: shot[15].v / 4, scale: fieldScale('Pole Vault'), rank: 16, width: 960, radius: 8 })
    expect(vault.ticks.some(tick => /higher$/.test(tick.text))).toBe(true)
    expect(vault.aria).toMatch(/higher than the line/)
  })
})

describe('the field line on the upright column', () => {
  const relay = Array.from({ length: 50 }, (_, index) => ({ rank: index + 1, name: `School ${index + 1}`, v: 184 + index * 0.08 }))

  it('tags the line at the end of the lanes, clear of the qualifying label and every runner label', () => {
    for (const fieldRank of [9, 13, 15]) {
      const layout = layoutColumn({ rows: relay, lineV: relay[11].v, dist: 1600, rank: 12, fieldRank, width: 380, height: 760, bottom: 52 })
      const { tag, y } = layout.field
      expect(tag.x0).toBeGreaterThanOrEqual(layout.laneTo)
      expect(tag.x1).toBeLessThanOrEqual(layout.width)
      // On the field line's own side of the qualifying line.
      expect(Math.sign(tag.y0 + tag.y1 - 2 * layout.lineY)).toBe(Math.sign(y - layout.lineY))
      const meet = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
      expect(meet(tag, layout.lineLabel)).toBe(false)
      for (const label of layout.labels) expect(meet(tag, label)).toBe(false)
      expect(tag.y0 > layout.lineY + 2 || tag.y1 < layout.lineY - 2).toBe(true)
    }
  })

  it('has no field line when the layout is given none', () => {
    const layout = layoutColumn({ rows: relay, lineV: relay[11].v, dist: 1600, rank: 12, width: 380, height: 760, bottom: 52 })
    expect(layout.field).toBeNull()
  })
})

describe('chips when the field went past the line', () => {
  it('leaves a first one out the field took in as a plain dot', async () => {
    const { chipDots } = await import('../src/utils/chips')
    const placed = [1, 12, 13, 14].map(rank => ({ rank }))
    expect(chipDots(placed, 12).map(dot => dot.rank)).toEqual([1, 13])
    expect(chipDots(placed, 12, 13).map(dot => dot.rank)).toEqual([1])
    expect(chipDots(placed, 12, 10).map(dot => dot.rank)).toEqual([1, 13])
  })
})
