import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { serveSite, siteFiles } from './site'

const PLOT = { width: 400, height: 700 }
const ROW_H = 40
let tableTop = 0

function field(count = 30, rank = 12) {
  const rankings = Array.from({ length: count }, (_, index) => {
    const seconds = 554 + index * 0.5
    const time = `9:${(seconds - 540).toFixed(2).padStart(5, '0')}`
    return { rank: index + 1, athlete: `School ${index + 1}`, team: `School ${index + 1}`, time }
  })
  return {
    year: '2025-2026',
    event: 'Distance Medley Relay',
    season: 'indoor',
    region: 'National',
    gender: 'm',
    rankings,
    qualification: { rank, is_relay: true, status: 'available', entry: { ...rankings[rank - 1] } },
  }
}

function serve(record) {
  serveSite(siteFiles([record]))
}

function holds(query, width, reduce) {
  return query.split(' and ').every(part => {
    const min = part.match(/min-width:\s*(\d+)px/)
    const max = part.match(/max-width:\s*(\d+)px/)
    if (min) return width >= Number(min[1])
    if (max) return width <= Number(max[1])
    if (/prefers-reduced-motion/.test(part)) return reduce
    return false
  })
}

// jsdom has no layout: give it a screen width, a plot size, and rows stacked ROW_H apart.
function screenAt(width, { reduce = false } = {}) {
  vi.stubGlobal('innerWidth', width)
  vi.stubGlobal('matchMedia', query => ({
    matches: holds(query, width, reduce),
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function size() {
    return this.classList.contains('plot') ? PLOT.width : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function size() {
    return this.classList.contains('plot') ? PLOT.height : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box() {
    const rank = this.dataset?.rank
    if (this.tagName === 'TR' && rank) {
      const top = Number(rank) * ROW_H
      return { top, bottom: top + ROW_H, left: 0, right: 600, width: 600, height: ROW_H, x: 0, y: top }
    }
    if (this.tagName === 'TABLE') {
      return { top: tableTop, bottom: tableTop + 1200, left: 0, right: 600, width: 600, height: 1200, x: 0, y: tableTop }
    }
    if (this.tagName === 'svg' || this.tagName === 'SVG') {
      return { top: 0, left: 0, bottom: PLOT.height, right: PLOT.width, width: PLOT.width, height: PLOT.height, x: 0, y: 0 }
    }
    return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }
  })
}

function dotAt(rank) {
  const dot = document.querySelector(`.rail .dot[data-rank="${rank}"]`)
  const [, x, y] = dot.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)
  return { dot, x: Number(x), y: Number(y) }
}

async function openWide(width = 1440, options) {
  screenAt(width, options)
  window.history.replaceState(null, '', '/?s=indoor&g=m&event=distance-medley-relay')
  serve(field())
  render(<App />)
  await screen.findByText('12', { selector: 'tr.bubble .pl' })
}

afterEach(() => {
  tableTop = 0
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('split heat sheet', () => {
  it('stands the race up beside the table from 1100px and keeps the flat strip below that', async () => {
    await openWide(1440)
    const rail = await waitFor(() => {
      const node = document.querySelector('.split > aside.rail figure.race.column svg')
      expect(node).toBeTruthy()
      return node
    })
    expect(document.querySelector('.split > .split-sheet table')).toBeTruthy()
    expect(document.querySelectorAll('figure.race')).toHaveLength(1)
    expect(document.querySelector('.index nav.events')).toBeTruthy()
    expect(document.querySelector('h1 .picker')).toBeNull()
    expect(rail.getAttribute('aria-label')).toMatch(/ahead at the top/)
    expect(rail.textContent).toContain('Qualifying line')
    expect(rail.textContent).toMatch(/m (ahead|behind)/)
    cleanup()
    vi.restoreAllMocks()

    await openWide(1200)
    await waitFor(() => expect(document.querySelector('aside.rail svg')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Change event, gender or season/ })).toBeTruthy()
    expect(document.querySelector('dialog.sheet')).toBeTruthy()
    cleanup()
    vi.restoreAllMocks()

    for (const width of [1099, 390]) {
      await openWide(width)
      const strip = document.querySelector('figure.race')
      expect(strip).toBeTruthy()
      expect(strip.classList.contains('column')).toBe(false)
      expect(document.querySelector('.split')).toBeNull()
      expect(document.querySelector('aside.rail')).toBeNull()
      expect(strip.compareDocumentPosition(document.querySelector('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      cleanup()
      vi.restoreAllMocks()
    }
  })

  it('names the site in the header and the document title, short on narrow screens', async () => {
    await openWide(1440)
    expect(document.title).toBe('Men’s distance medley relay · NCAA TF Qualification Monitor')
    const link = screen.getByRole('link', { name: 'NCAA TF Qualification Monitor' })
    expect(link.querySelector('.mark-full').textContent).toBe('NCAA TF Qualification Monitor')
    expect(link.querySelector('.mark-short').textContent).toBe('NCAA TF Qualification Monitor')
    expect(document.querySelector('header.top').classList.contains('event')).toBe(true)
    expect(document.querySelector('.wrap').classList.contains('event')).toBe(true)
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 960px\)\{ \.mark-full\{display:none\} \.mark-short\{display:inline\} \}/)
    const wideRules = css.slice(css.indexOf('@media (min-width: 1440px){'))
    const wideBlock = wideRules.slice(0, wideRules.indexOf('\n}\n'))
    // The page content stops at 1680px; the dark nav runs full width with its content lined up with the page.
    expect(wideBlock).toMatch(/\.wrap\.event\{max-width:1680px;margin-left:auto;margin-right:auto\}/)
    expect(wideBlock).toMatch(/\.top\.event\{padding-left:max\(40px,calc\(50% - 800px\)\);padding-right:max\(40px,calc\(50% - 800px\)\)\}/)
    expect(wideBlock).toMatch(/\.split\{grid-template-columns:minmax\(0,62\.5fr\) minmax\(0,37\.5fr\)\}/)
  })

  it('pins the rail under the header only on wide screens', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const wide = css.slice(css.indexOf('@media (min-width: 1100px){'))
    const block = wide.slice(0, wide.indexOf('\n}\n'))
    expect(block).toMatch(/\.rail\{position:sticky;top:calc\(var\(--head, 66px\) \+ 24px\);height:calc\(100vh - var\(--head, 66px\) - 48px\)/)
    expect(block).toMatch(/\.split thead th\{position:sticky;top:calc\(var\(--head, 66px\) \+ 24px\)/)
    expect(block).toMatch(/\.split table\[data-stuck\] thead th::before\{/)
    expect(block).toMatch(/grid-template-columns:minmax\(0,calc\(\(100% - 48px\) \* \.64\)\) minmax\(0,1fr\);gap:0 16px/)
    expect(block).toMatch(/\.wrap\{gap:24px\}/)
    expect(css).toMatch(/\.race\.column \.labels\{transition:none\}/)
    expect(block).toMatch(/\.split td\.team\{white-space:nowrap\}/)
    expect(css).toMatch(/\.race \.seen\{fill:var\(--sel\);fill-opacity:\.5\}/)
    expect(css).toMatch(/\.race\.column \.lane\{stroke:var\(--lane\)\}/)
    expect(css).toMatch(/--rule:#ebebe8; --lane:#d9d9d5;/)
    // Outside the wide block only the nav, the event index and, on phones, the strip stack are pinned,
    // plus the dialog's own header, which sticks inside the dialog and not to the page.
    const pinned = css.replace(block, '').match(/[^{}\n]+\{[^}]*sticky[^}]*\}/g).map(rule => rule.slice(0, rule.indexOf('{')).trim())
    expect(pinned).toEqual(['.top', '.index', '.stick', '.detail-head'])
    expect(css).not.toMatch(/scroll-behavior/)
  })

  it('marks the table as stuck once its header reaches the pinned line', async () => {
    tableTop = 400
    await openWide(1440)
    await waitFor(() => expect(document.querySelector('.rail .seen')).toBeTruthy())
    const table = document.querySelector('main table')
    expect(table.dataset.stuck).toBeUndefined()
    tableTop = -200
    fireEvent.scroll(window)
    await waitFor(() => expect(table.dataset.stuck).toBe(''))
    tableTop = 400
    fireEvent.scroll(window)
    await waitFor(() => expect(table.dataset.stuck).toBeUndefined())
  })

  it('keeps the band and the labels to the lanes', async () => {
    await openWide(1440)
    await waitFor(() => expect(document.querySelector('.rail .seen')).toBeTruthy())
    const lanes = [...document.querySelectorAll('.rail line.lane')].map(line => Number(line.getAttribute('x1')))
    expect(lanes).toHaveLength(9)
    const band = document.querySelector('.rail .seen')
    const x = Number(band.getAttribute('x'))
    expect(x).toBeCloseTo(lanes[0], 6)
    expect(x + Number(band.getAttribute('width'))).toBeCloseTo(lanes[8], 6)
    const ticks = [...document.querySelectorAll('.rail svg > text')].filter(node => /m (ahead|behind)$/.test(node.textContent))
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.every(node => Number(node.getAttribute('x')) === 0)).toBe(true)
    const labels = [...document.querySelectorAll('.rail .labels text')]
    expect(labels.map(node => node.dataset.rank)).toEqual(['1', '13', '30'])
    expect(labels[1].textContent).toMatch(/^First one outSchool 13, 13th/)
    expect(document.querySelector('.rail .line-label').textContent).toBe('Qualifying lineSchool 12, 12th')
    const leads = [...document.querySelectorAll('.rail .leads polyline')]
    expect(leads).toHaveLength(3)
    for (const [index, node] of leads.entries()) {
      const label = labels[index]
      const dot = dotAt(Number(label.dataset.rank))
      const points = node.getAttribute('points').split(' ').map(pair => pair.split(',').map(Number))
      expect(node.dataset.rank).toBe(label.dataset.rank)
      expect(points[0][1]).toBeCloseTo(dot.y, 6)
      expect(points.at(-1)[0]).toBeGreaterThan(lanes[8])
      expect(label.getAttribute('text-anchor')).toBe('end')
    }
  })

  it('keeps the qualifying label in place while a row or dot is hovered', async () => {
    await openWide(1440)
    const svg = await waitFor(() => {
      const node = document.querySelector('aside.rail svg')
      expect(node).toBeTruthy()
      return node
    })
    const label = () => document.querySelector('.rail .line-label')
    const before = label().outerHTML
    expect(label().textContent).toBe('Qualifying lineSchool 12, 12th')
    for (const rank of [1, 8, 11, 12, 13, 20]) {
      const row = document.querySelector(`tbody tr[data-rank="${rank}"]`)
      fireEvent.pointerEnter(row)
      expect(document.querySelector('.rail .readout')).toBeTruthy()
      expect(label().outerHTML).toBe(before)
      fireEvent.pointerLeave(row)
      const dot = dotAt(rank)
      fireEvent.pointerMove(svg, { clientX: dot.x, clientY: dot.y, pointerType: 'mouse' })
      expect(document.querySelector('.rail .readout')).toBeTruthy()
      expect(label().outerHTML).toBe(before)
    }
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).not.toMatch(/line-label[^{]*\{[^}]*opacity/)
  })

  it('hides the three runner labels while a row is hovered and brings them straight back', async () => {
    await openWide(1440)
    await waitFor(() => expect(document.querySelector('aside.rail svg')).toBeTruthy())
    const figure = document.querySelector('.rail figure')
    const row = document.querySelector('tbody tr[data-rank="8"]')
    expect(figure.classList.contains('reading')).toBe(false)
    fireEvent.pointerEnter(row)
    expect(figure.classList.contains('reading')).toBe(true)
    expect(document.querySelector('.rail .line-label').closest('.labels')).toBeNull()
    fireEvent.pointerLeave(row)
    expect(figure.classList.contains('reading')).toBe(false)
    expect(document.querySelectorAll('.rail .labels text')).toHaveLength(3)
  })

  it('rings the dot and labels it when a row is hovered or focused', async () => {
    await openWide(1440)
    await waitFor(() => expect(document.querySelector('aside.rail svg')).toBeTruthy())
    const row = document.querySelector('tbody tr[data-rank="5"]')
    fireEvent.pointerEnter(row)
    expect(dotAt(5).dot.classList.contains('on')).toBe(true)
    expect(document.querySelector('.rail .readout').textContent).toMatch(/^5\. School 5/)
    expect(document.querySelector('.rail .readout').textContent).toMatch(/m ahead/)
    fireEvent.pointerLeave(row)
    expect(dotAt(5).dot.classList.contains('on')).toBe(false)
    expect(document.querySelector('.rail .readout')).toBeNull()

    fireEvent.focus(document.querySelector('tbody tr[data-rank="16"]'))
    expect(dotAt(16).dot.classList.contains('on')).toBe(true)
    expect(document.querySelector('.rail .readout').textContent).toMatch(/^16\. School 16.* back$/)
  })

  it('highlights the row for a hovered dot, and offers a chip when that row is off screen', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await openWide(1440)
    const svg = await waitFor(() => {
      const node = document.querySelector('aside.rail svg')
      expect(node).toBeTruthy()
      return node
    })
    await waitFor(() => expect(document.querySelector('.rail .seen')).toBeTruthy())

    const near = dotAt(5)
    fireEvent.pointerMove(svg, { clientX: near.x, clientY: near.y, pointerType: 'mouse' })
    expect(document.querySelector('tbody tr[data-rank="5"]').classList.contains('on')).toBe(true)
    expect(near.dot.classList.contains('on')).toBe(true)
    expect(document.querySelector('.chip')).toBeNull()

    const far = dotAt(24)
    fireEvent.pointerMove(svg, { clientX: far.x, clientY: far.y, pointerType: 'mouse' })
    expect(far.dot.classList.contains('on')).toBe(true)
    expect(document.querySelector('tbody tr[data-rank="24"]')).toBeNull()
    const chip = screen.getByRole('button', { name: 'Show 24. School 24 in the table' })
    expect(chip.textContent).toBe('24. School 24 ↓')

    fireEvent.pointerMove(svg, { clientX: PLOT.width - 2, clientY: far.y, pointerType: 'mouse' })
    expect(screen.getByRole('button', { name: /Show 24\./ })).toBeTruthy()

    fireEvent.click(chip)
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    const target = document.querySelector('tbody tr[data-rank="24"]')
    expect(scroll.mock.contexts.at(-1)).toBe(target)
    expect(scroll.mock.calls.at(-1)[0]).toEqual({ block: 'center', behavior: 'smooth' })
    expect(document.activeElement).toBe(target)
    expect(target.classList.contains('on')).toBe(true)

    fireEvent.pointerLeave(document.querySelector('aside.rail'))
    expect(document.querySelector('.chip')).toBeNull()
    expect(target.classList.contains('on')).toBe(true)
    expect(dotAt(24).dot.classList.contains('on')).toBe(true)
    delete Element.prototype.scrollIntoView
  })

  it('jumps instead of gliding when motion is reduced', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await openWide(1440, { reduce: true })
    const svg = await waitFor(() => {
      const node = document.querySelector('aside.rail svg')
      expect(node).toBeTruthy()
      return node
    })
    await waitFor(() => expect(document.querySelector('.rail .seen')).toBeTruthy())
    const far = dotAt(20)
    fireEvent.pointerMove(svg, { clientX: far.x, clientY: far.y, pointerType: 'mouse' })
    expect(document.querySelector('tbody tr[data-rank="20"]').classList.contains('on')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Show 20\./ }))
    expect(scroll.mock.calls.at(-1)[0]).toEqual({ block: 'center', behavior: 'auto' })
    delete Element.prototype.scrollIntoView
  })
})
