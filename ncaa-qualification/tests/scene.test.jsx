import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import FieldScene from '../src/components/FieldScene'
import { layoutScene, sceneFor, sceneHeight, sceneReadout } from '../src/utils/scene'
import { fieldScale } from '../src/utils/strip'

afterEach(cleanup)

// A list with ties, the way jumps and throws come: `count` marks from `best` down by `step`, two at each mark.
function marks(count, best, step) {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    name: `Athlete${index + 1}, A`,
    team: `School ${index + 1}`,
    v: Number((best - Math.floor(index / 2) * step).toFixed(2)),
  }))
}

const EVENTS = [
  { name: 'Shot Put', rows: marks(50, 21.2, 0.11) },
  { name: 'Javelin', rows: marks(60, 80.4, 0.5) },
  { name: 'High Jump', rows: marks(50, 2.3, 0.02) },
  { name: 'Pole Vault', rows: marks(50, 5.8, 0.05) },
  { name: 'Long Jump', rows: marks(50, 8.3, 0.02) },
]

const meet = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

function layoutFor(event, { upright, width, height, fieldRank = null }) {
  const scene = sceneFor(event.name)
  return layoutScene({
    scene,
    rows: event.rows,
    lineV: event.rows[15].v,
    rank: 16,
    fieldRank,
    scale: fieldScale(event.name),
    width,
    height: height ?? sceneHeight(scene, width),
    upright,
    radius: upright ? 5 : 4.5,
    chipR: upright ? 12 : 10,
  })
}

describe('which venue each event gets', () => {
  it('draws throws on a sector, the javelin on its own, bars for the vertical jumps and a pit for the others', () => {
    expect(sceneFor('Shot Put')).toBe('sector')
    expect(sceneFor('Weight Throw')).toBe('sector')
    expect(sceneFor('Discus')).toBe('sector')
    expect(sceneFor('Hammer')).toBe('sector')
    expect(sceneFor('Javelin')).toBe('javelin')
    expect(sceneFor('High Jump')).toBe('bar')
    expect(sceneFor('Pole Vault')).toBe('vault')
    expect(sceneFor('Long Jump')).toBe('pit')
    expect(sceneFor('Triple Jump')).toBe('pit')
    expect(sceneFor('Heptathlon')).toBeNull()
    expect(sceneFor('Mile')).toBeNull()
  })
})

describe('the venue layouts', () => {
  const shapes = [
    { upright: true, width: 380, height: 700 },
    { upright: false, width: 343 },
    { upright: false, width: 700 },
  ]

  for (const event of EVENTS) {
    for (const shape of shapes) {
      it(`keeps every ${event.name} mark inside a ${shape.upright ? 'standing' : `${shape.width}px flat`} venue, touching nothing`, () => {
        const layout = layoutFor(event, { ...shape, fieldRank: 18 })
        expect(layout.placed).toHaveLength(event.rows.length)
        for (const dot of layout.placed) {
          expect(dot.x - dot.rr).toBeGreaterThanOrEqual(0)
          expect(dot.x + dot.rr).toBeLessThanOrEqual(layout.width)
          expect(dot.y - dot.rr).toBeGreaterThanOrEqual(0)
          expect(dot.y + dot.rr).toBeLessThanOrEqual(layout.height)
          expect(meet({ x0: dot.x - dot.rr, x1: dot.x + dot.rr, y0: dot.y - dot.rr, y1: dot.y + dot.rr }, layout.line.label)).toBe(false)
        }
        layout.placed.forEach((dot, index) => layout.placed.slice(index + 1).forEach(other => {
          expect(Math.hypot(dot.x - other.x, dot.y - other.y)).toBeGreaterThanOrEqual(dot.rr + other.rr)
        }))
        const { tag } = layout.field
        expect(tag.x0).toBeGreaterThanOrEqual(0)
        expect(tag.x1).toBeLessThanOrEqual(layout.width)
        expect(meet(tag, layout.line.label)).toBe(false)
        for (const tick of layout.ticks) expect(meet(tick.box, tag) || meet(tick.box, layout.line.label)).toBe(false)
        if (layout.leaderLabel) {
          expect(layout.leaderLabel.x0).toBeGreaterThanOrEqual(0)
          expect(layout.leaderLabel.x1).toBeLessThanOrEqual(layout.width)
        }
      })
    }
  }

  it('puts every cleared height above the bar and every lower one under it', () => {
    const event = EVENTS.find(item => item.name === 'High Jump')
    const layout = layoutFor(event, { upright: false, width: 343 })
    const barY = Number(layout.line.path.match(/^M[\d.]+ ([\d.]+)/)[1])
    for (const dot of layout.placed) {
      if (dot.v > layout.lineV) expect(dot.y).toBeLessThan(barY)
      if (dot.v < layout.lineV) expect(dot.y).toBeGreaterThan(barY)
    }
  })

  it('lands longer marks farther from the board in the pit and farther from the circle in the sector', () => {
    for (const name of ['Long Jump', 'Shot Put']) {
      const event = EVENTS.find(item => item.name === name)
      const layout = layoutFor(event, { upright: false, width: 700 })
      const best = layout.placed.find(dot => dot.rank === 1)
      const last = layout.placed.find(dot => dot.rank === 50)
      expect(best.x).toBeGreaterThan(last.x)
    }
  })

  it('says how far each mark is from the line, fitted inside the picture', () => {
    const event = EVENTS.find(item => item.name === 'Shot Put')
    const layout = layoutFor(event, { upright: false, width: 343 })
    const out = sceneReadout(layout, layout.placed.find(dot => dot.rank === 20), 16)
    expect(out.text).toMatch(/^20\. /)
    expect(out.text).toMatch(/m short$|20\.\s/)
    const vault = layoutFor(EVENTS.find(item => item.name === 'Pole Vault'), { upright: true, width: 380, height: 700 })
    expect(sceneReadout(vault, vault.placed.find(dot => dot.rank === 1), 16).text).toMatch(/higher$/)
  })
})

describe('the venue on the page', () => {
  const event = EVENTS.find(item => item.name === 'High Jump')

  it('draws the bar, a dot for every place, the field line and the logo chip for the leader', () => {
    const view = render(
      <FieldScene scene="bar" rows={event.rows} scale={fieldScale('High Jump')} lineRank={16} fieldRank={18} width={343} phone listed={50} />,
    )
    const figure = view.container.querySelector('figure.race.card.scene')
    expect(figure.dataset.scene).toBe('bar')
    expect(figure.querySelectorAll('.dot')).toHaveLength(50)
    expect(figure.querySelector('.fl.bar path.stripe')).toBeTruthy()
    expect(figure.querySelector('.fld-tag').textContent).toBe('Field line')
    expect(figure.querySelector('.dot[data-rank="1"] .cd-back')).toBeTruthy()
    expect(figure.querySelector('svg').getAttribute('aria-label')).toMatch(/against a bar set at the line, 2\.16\u00a0m/)
  })

  it('shows the place being pointed at, and tells the page', () => {
    let picked = null
    const view = render(
      <FieldScene scene="bar" rows={event.rows} scale={fieldScale('High Jump')} lineRank={16} width={343} listed={50} activeRank={20} onHover={rank => { picked = rank }} />,
    )
    expect(view.container.querySelector('.readout').textContent).toMatch(/^20\. .*0\.04\u2009m lower$/)
    expect(view.container.querySelector('figure').classList.contains('reading')).toBe(true)
    const dot = view.container.querySelector('.dot[data-rank="5"]')
    const [, x, y] = dot.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/)
    const svg = view.container.querySelector('svg')
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: Number(svg.getAttribute('width')), height: Number(svg.getAttribute('height')) })
    fireEvent.pointerDown(svg, { clientX: Number(x), clientY: Number(y), pointerType: 'touch' })
    expect(picked).toBe(5)
  })
})
