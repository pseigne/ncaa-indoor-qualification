import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { serveSite, siteFiles } from './site'
import { CHIP, CHIP_PHONE, chipCentre, chipDots, chipRadius, chipsLast, coveredDots, liftedDot, LOGO_SHARE } from '../src/utils/chips'
import { fitReadout, layoutStrip, readoutNames } from '../src/utils/strip'
import { BAND, FADE, freeTop, nearestRow, readingLine } from '../src/utils/active'
import { logoFor, resetLogos, teamInitials } from '../src/utils/logos'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const PLOT = { width: 400, height: 700 }

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

function serve(record, logos = null) {
  serveSite(siteFiles([record]), { logos })
}

function holds(query, width) {
  return query.split(' and ').every(part => {
    const min = part.match(/min-width:\s*(\d+)px/)
    const max = part.match(/max-width:\s*(\d+)px/)
    if (min) return width >= Number(min[1])
    if (max) return width <= Number(max[1])
    return false
  })
}

function screenAt(width) {
  vi.stubGlobal('innerWidth', width)
  vi.stubGlobal('matchMedia', query => ({ matches: holds(query, width), addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function size() {
    return this.classList.contains('plot') ? PLOT.width : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function size() {
    return this.classList.contains('plot') ? PLOT.height : 0
  })
}

async function open(width, { record = field(), logos = null, url = '/?s=indoor&g=m&event=distance-medley-relay' } = {}) {
  screenAt(width)
  window.history.replaceState(null, '', url)
  serve(record, logos)
  render(<App />)
  await screen.findByText(String(record.qualification.rank), { selector: 'tr.bubble .pl' })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetLogos()
  window.history.replaceState(null, '', '/')
})

// Every plain dot comes before the chips in the drawing, so the chips sit on top.
function chipsDrawnLast(svg) {
  const all = [...svg.querySelectorAll('.dot')]
  const firstChip = all.findIndex(dot => dot.classList.contains('chipdot'))
  return firstChip >= 0 && all.slice(firstChip).every(dot => dot.classList.contains('chipdot'))
}

const radius = node => Number(node.querySelector(':scope > circle:first-child').getAttribute('r'))

const dots = ranks => ranks.map((rank, index) => ({ rank, name: `Runner ${index}`, x: index * 20, y: 0 }))

describe('which dots get a logo chip', () => {
  it('gives one to the leader and one to the first one out, nobody else', () => {
    const placed = dots([1, 2, 3, 12, 13, 14, 30])
    expect(chipDots(placed, 12).map(dot => dot.rank)).toEqual([1, 13])
  })

  it('gives only the leader one when the line is the last entry, or when there is no line', () => {
    expect(chipDots(dots([1, 2, 3, 4]), 4).map(dot => dot.rank)).toEqual([1])
    expect(chipDots(dots([1, 2, 3, 4]), undefined).map(dot => dot.rank)).toEqual([1])
  })

  it('gives a shared place one chip, on the first dot listed there, like the gutter labels', () => {
    const placed = dots([1, 1, 2, 12, 13, 13, 15])
    const chips = chipDots(placed, 12)
    expect(chips).toEqual([placed[0], placed[4]])
  })

  it('gives the line holder its chip when the line is first place, and the next runner the other', () => {
    expect(chipDots(dots([1, 2, 3]), 1).map(dot => dot.rank)).toEqual([1, 2])
    expect(chipDots([], 12)).toEqual([])
  })

  it('draws the chips last without moving anyone', () => {
    const placed = dots([1, 2, 12, 13, 14])
    const order = chipsLast(placed, chipDots(placed, 12))
    expect(order.map(dot => dot.rank)).toEqual([2, 12, 14, 1, 13])
    expect(order.every(dot => placed.includes(dot))).toBe(true)
  })

  it('gives chips a fixed size: 12 on desktop, 10 on a phone strip', () => {
    expect(chipRadius()).toBe(12)
    expect(chipRadius(false)).toBe(CHIP)
    expect(chipRadius(true)).toBe(10)
    expect(CHIP_PHONE).toBe(10)
    expect(LOGO_SHARE).toBeCloseTo(0.7, 5)
  })
})

describe('initials when there is no logo', () => {
  it('builds initials from the team name, dropping a relay letter', () => {
    expect(teamInitials('Texas A&M')).toBe('TA')
    expect(teamInitials('Oregon (B)')).toBe('OR')
    expect(teamInitials('University of the Pacific')).toBe('UP')
    expect(logoFor('Oregon (B)', null)).toEqual({ name: 'Oregon', initials: 'OR', src: null })
    expect(logoFor('Oregon (B)', { Oregon: '2483' }).src).toMatch(/team-logos\/2483\.png$/)
    expect(logoFor('', null)).toBeNull()
  })

  it('draws initials in the table, the hero and both chips when the logo map is missing', async () => {
    await open(1440)
    await waitFor(() => expect(document.querySelectorAll('.rail .chipdot')).toHaveLength(2))
    expect(document.querySelectorAll('img.logo')).toHaveLength(0)
    const first = document.querySelector('tr[data-rank="1"] .logo-ini')
    expect(first.dataset.initials).toBe('SC')
    expect(first.closest('td').textContent).toBe('School 1')
    expect(document.querySelector('.herocard .lead .lead-logo.logo-ini').dataset.initials).toBe('SC')
    const chips = [...document.querySelectorAll('.rail .chipdot')]
    expect(chips.map(chip => chip.dataset.rank)).toEqual(['1', '13'])
    expect(chips.every(chip => chip.querySelector('text.cd-ini').textContent === 'SC')).toBe(true)
    expect(chips.some(chip => chip.querySelector('image'))).toBe(false)
  })
})

describe('logos from the local map', () => {
  const logos = { 'School 1': '101', 'School 12': '112', 'School 13': '113' }

  it('puts a logo before the team name, in the hero chip and on the two chips', async () => {
    await open(1440, { logos })
    await waitFor(() => expect(document.querySelector('tr[data-rank="1"] img.logo')).toBeTruthy())
    expect(document.querySelector('tr[data-rank="1"] img.logo').getAttribute('src')).toBe('/team-logos/101.png')
    expect(document.querySelector('tr[data-rank="2"] .logo-ini').dataset.initials).toBe('SC')
    expect(document.querySelector('.herocard .lead img.lead-logo').getAttribute('src')).toBe('/team-logos/112.png')
    const chip = rank => document.querySelector(`.rail .chipdot[data-rank="${rank}"]`)
    expect(chip(1).querySelector('image').getAttribute('href')).toBe('/team-logos/101.png')
    expect(chip(13).querySelector('image').getAttribute('href')).toBe('/team-logos/113.png')
    // The logo fills about 70% of the chip's diameter, centred.
    for (const rank of [1, 13]) {
      const image = chip(rank).querySelector('image')
      const r = Number(chip(rank).querySelector('.cd-back').getAttribute('r'))
      const size = Number(image.getAttribute('width'))
      expect(size / (2 * r)).toBeCloseTo(0.7, 2)
      expect(Number(image.getAttribute('height'))).toBe(size)
      expect(Number(image.getAttribute('x'))).toBeCloseTo(-size / 2, 5)
      expect(Number(image.getAttribute('y'))).toBeCloseTo(-size / 2, 5)
    }
  })

  it('falls back to initials when a logo file does not load', async () => {
    await open(1440, { logos })
    const img = await waitFor(() => {
      const node = document.querySelector('tr[data-rank="1"] img.logo')
      expect(node).toBeTruthy()
      return node
    })
    fireEvent.error(img)
    await waitFor(() => expect(document.querySelector('tr[data-rank="1"] .logo-ini').dataset.initials).toBe('SC'))
  })
})

describe('chips on the column and the strip', () => {
  it('draws only the leader and the first one out as chips in the column, last, with the outer ring on the first one out', async () => {
    await open(1440)
    await waitFor(() => expect(document.querySelectorAll('.rail .chipdot')).toHaveLength(2))
    const all = [...document.querySelectorAll('.rail .dot')]
    expect(all.slice(-2).map(dot => dot.dataset.rank)).toEqual(['1', '13'])
    expect(all.slice(0, -2).every(dot => dot.querySelector('circle.pt') && !dot.querySelector('.cd-back'))).toBe(true)
    expect(chipsDrawnLast(document.querySelector('.rail svg'))).toBe(true)
    const r = rank => Number(document.querySelector(`.rail .chipdot[data-rank="${rank}"] .cd-back`).getAttribute('r'))
    expect(r(1)).toBe(12)
    expect(r(13)).toBe(12)
    // Plain dots still change size: a non-qualifier's dot is drawn a little smaller than a qualifier's.
    expect(radius(document.querySelector('.rail .dot.out:not(.chipdot)'))).toBeLessThan(radius(document.querySelector('.rail .dot.in:not(.chipdot)')))
    expect(document.querySelector('.rail .chipdot[data-rank="1"] .cd-outer')).toBeNull()
    expect(Number(document.querySelector('.rail .chipdot[data-rank="13"] .cd-outer').getAttribute('r'))).toBe(r(13) + 3)
  })

  it('draws the two chips on the phone strip too', async () => {
    await open(390)
    const chips = [...document.querySelectorAll('figure.race.card .chipdot')]
    expect(chips.map(chip => chip.dataset.rank)).toEqual(['1', '13'])
    expect(chips.map(chip => Number(chip.querySelector('.cd-back').getAttribute('r')))).toEqual([10, 10])
    expect(document.querySelectorAll('figure.race.card .dot')).toHaveLength(30)
    expect(chipsDrawnLast(document.querySelector('figure.race.card svg'))).toBe(true)
  })

  it('draws 12px chips on the desktop strip, last', async () => {
    await open(900)
    const chips = [...document.querySelectorAll('figure.race.card .chipdot')]
    expect(chips.map(chip => chip.dataset.rank)).toEqual(['1', '13'])
    expect(chips.map(chip => Number(chip.querySelector('.cd-back').getAttribute('r')))).toEqual([12, 12])
    expect(chipsDrawnLast(document.querySelector('figure.race.card svg'))).toBe(true)
    expect(radius(document.querySelector('figure.race.card .dot.out:not(.chipdot)'))).toBeLessThan(radius(document.querySelector('figure.race.card .dot.in:not(.chipdot)')))
  })

  it('keeps the first one out at full size when it sits right on the qualifying line', async () => {
    const record = field()
    record.rankings[12].time = record.rankings[11].time
    for (const [width, size] of [[1440, 12], [900, 12], [390, 10]]) {
      await open(width, { record })
      const chip = await waitFor(() => {
        const node = document.querySelector('.race .chipdot[data-rank="13"]')
        expect(node).toBeTruthy()
        return node
      })
      expect(Number(chip.querySelector('.cd-back').getAttribute('r'))).toBe(size)
      expect(Number(chip.querySelector('.cd-outer').getAttribute('r'))).toBe(size + 3)
      cleanup()
      vi.restoreAllMocks()
    }
  })

  it('leaves the first-one-out chip off when the line is the last entry', async () => {
    const record = field(12, 12)
    await open(1440, { record })
    await waitFor(() => expect(document.querySelectorAll('.rail .chipdot')).toHaveLength(1))
    expect(document.querySelector('.rail .chipdot').dataset.rank).toBe('1')
  })

  it('draws the qualifying line in 3px black on the column and the strip', () => {
    expect(css).toMatch(/\.rail \.race \.fl line,\.race\.card \.fl line\{stroke:#151515;stroke-width:3\}/)
    expect(css).toMatch(/\.rail \.dot\.bub \.pt,\.race\.card \.dot\.bub \.pt\{fill:#151515;stroke:#fff;stroke-width:2\}/)
    expect(css).toMatch(/\.rail \.dot\.out \.pt,\.race\.card \.dot\.out \.pt\{fill:none;stroke:#fff;stroke-width:1\.75\}/)
  })
})

describe('the nav', () => {
  it('shows the full and the short title, and switches at 960px', async () => {
    await open(1440)
    const link = screen.getByRole('link', { name: 'NCAA TF Qualification Monitor' })
    expect(link.querySelector('.mark-full').textContent).toBe('NCAA TF Qualification Monitor')
    expect(link.querySelector('.mark-short').textContent).toBe('NCAA TF Qualification Monitor')
    expect(link.querySelector('.mark-short').getAttribute('aria-hidden')).toBe('true')
    expect(css).toMatch(/@media \(max-width: 960px\)\{ \.mark-full\{display:none\} \.mark-short\{display:inline\} \}/)
  })

  it('keeps the toggles as links with the current one marked, in pill groups over the event list', async () => {
    await open(1440)
    const nav = screen.getByRole('navigation', { name: 'Season and gender' })
    expect(nav.closest('.index')).toBeTruthy()
    expect(document.querySelector('header.top .grp')).toBeNull()
    expect([...nav.querySelectorAll('.grp')].map(group => group.textContent)).toEqual(['MenWomen', 'IndoorOutdoor'])
    const current = () => [...nav.querySelectorAll('a[aria-current="page"]')].map(node => node.textContent)
    expect(current()).toEqual(['Men', 'Indoor'])
    fireEvent.click(screen.getByRole('link', { name: 'Women' }))
    await waitFor(() => expect(current()).toEqual(['Women', 'Indoor']))
    expect(window.location.search).toMatch(/g=f/)
    fireEvent.click(screen.getByRole('link', { name: 'Outdoor' }))
    await waitFor(() => expect(current()).toEqual(['Women', 'Outdoor', 'East']))
    expect([...nav.querySelectorAll('.grp')].map(group => group.textContent)).toEqual(['MenWomen', 'IndoorOutdoor', 'EastWest'])
    fireEvent.click(screen.getByRole('link', { name: 'West' }))
    await waitFor(() => expect(current()).toEqual(['Women', 'Outdoor', 'West']))
    expect(window.location.search).toMatch(/r=West/)
  })

  it('pins a dark nav with the orange curb and the year in a pill', () => {
    expect(css).toMatch(/\.top\{position:sticky;top:0;z-index:30;[^}]*background:var\(--nav\);[^}]*box-shadow:inset 0 -3px 0 var\(--track\),0 1px 0 #fff\}/)
    expect(css).toMatch(/--nav:#151515;/)
    expect(css).toMatch(/--track:#C4532F;/)
    expect(css).toMatch(/\.yearpick\{[^}]*border-radius:999px;background:rgba\(255,255,255,\.08\);color:var\(--paper\)\}/)
    expect(css).toMatch(/\.filters \[aria-current\]\{background:var\(--ink\);color:var\(--page\);font-weight:600\}/)
  })
})

describe('the stylesheet after minifying', () => {
  // The minifier folds font-stretch into a font shorthand in the same rule, which makes the whole
  // declaration invalid in the build: the conversion panel and the initials would lose their font.
  it('never sets font-stretch beside a font shorthand', () => {
    const rules = css.match(/[^{}]+\{[^{}]*\}/g)
    const mixed = rules.filter(rule => /(^|[{;])font:(?!inherit)/.test(rule) && /font-stretch:/.test(rule))
    expect(mixed).toEqual([])
    expect(css).toMatch(/\.pop\{[^}]*font-size:14px;font-weight:400;line-height:1\.45;font-stretch:100%/)
  })
})

describe('the qualifying line stays between the line holder and the first one out', () => {
  const translate = node => node.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number)

  it('draws a chip just clear of the line and the line holder, on its own side, and leaves far chips alone', () => {
    const opts = { r: 10, outline: true, dotRadius: 4.5 }
    // 4.5 holder radius + 1 + 10 chip + 3 outer ring
    expect(chipCentre(196, 200, -1, opts)).toBe(200 - 18.5)
    expect(chipCentre(120, 200, -1, opts)).toBe(120)
    expect(chipCentre(205, 200, 1, { r: 12, dotRadius: 5 })).toBe(200 + 18)
    expect(chipCentre(300, 200, 1, { r: 12, dotRadius: 5 })).toBe(300)
    expect(chipCentre(200, 200, 0, opts)).toBe(200)
  })

  it('keeps the first one out off the line on the phone strip when the two marks are tied', async () => {
    const record = field()
    record.rankings[12].time = record.rankings[11].time
    await open(390, { record })
    const svg = document.querySelector('figure.race.card svg')
    const lineX = Number(svg.querySelector('.fl line').getAttribute('x1'))
    const [chipX] = translate(svg.querySelector('.chipdot[data-rank="13"]'))
    const holder = svg.querySelector('.dot[data-rank="12"]')
    const [holderX] = translate(holder)
    const holderR = Number(holder.querySelector('.pt').getAttribute('r'))
    // The outer ring stays left of both the 3px line and the line holder's dot.
    expect(chipX + 10 + 3).toBeLessThan(lineX - 1.5)
    expect(chipX + 10 + 3).toBeLessThan(holderX - holderR)
    expect(holderX).toBeCloseTo(lineX, 5)
    // The gutter label's leader points at the chip where it is drawn.
    const lead = [...svg.querySelectorAll('.labels .lead-l')].find(line => Number(line.getAttribute('x1')) === chipX)
    expect(lead === undefined || Number(lead.getAttribute('x2')) === chipX).toBe(true)
  })

  it('keeps the first one out below the line in the column when the two marks are tied', async () => {
    const record = field()
    record.rankings[12].time = record.rankings[11].time
    await open(1440, { record })
    const svg = await waitFor(() => {
      const node = document.querySelector('.rail svg')
      expect(node.querySelector('.chipdot[data-rank="13"]')).toBeTruthy()
      return node
    })
    const lineY = Number(svg.querySelector('.fl line').getAttribute('y1'))
    const [, chipY] = translate(svg.querySelector('.chipdot[data-rank="13"]'))
    expect(chipY - 12 - 3).toBeGreaterThan(lineY + 1.5)
  })

  it('gives a phone turned sideways a narrower list so the table and its qualifying line fit the card', () => {
    const block = css.slice(css.indexOf('@media (min-width: 721px) and (max-width: 1099px){'))
    const rules = block.slice(0, block.indexOf('\n}\n'))
    expect(rules).toMatch(/\.wrap\.event\{grid-template-columns:clamp\(176px,22vw,224px\) minmax\(0,1fr\);gap:20px\}/)
    expect(rules).toMatch(/\.top\.event,\.wrap\.event\{padding-left:max\(24px, env\(safe-area-inset-left, 0px\)\);padding-right:max\(24px, env\(safe-area-inset-right, 0px\)\)\}/)
    expect(rules).toMatch(/\.tablecard td\.t\{width:auto\}/)
  })
})

describe('the sticky top on phones', () => {
  const phoneRules = () => {
    const at = css.lastIndexOf('@media (max-width: 720px){', css.indexOf('.stick{'))
    return css.slice(at, css.indexOf('\n}\n', at))
  }

  it('pins the strip under the nav with room for the one-line hero, only on phones', () => {
    const rules = phoneRules()
    expect(rules).toMatch(/\.stick\{--mini:36px;position:sticky;top:calc\(var\(--head, 60px\) \+ var\(--mini\)\);z-index:10;/)
    expect(rules).toMatch(/\.minihero\{display:flex;position:absolute;left:0;right:0;bottom:100%;height:var\(--mini\);/)
    expect(css).toMatch(/\n\.minihero\{display:none\}/)
    expect(css).toMatch(/\.minihero,\.minihero\.on\{transition:none\}/)
    const index = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(index).toMatch(/viewport-fit=cover/)
    expect(css).toMatch(/\.top\{padding:calc\(10px \+ env\(safe-area-inset-top, 0px\)\) max\(16px, env\(safe-area-inset-right, 0px\)\) 10px max\(16px, env\(safe-area-inset-left, 0px\)\)\}/)
  })

  it('puts the one-line hero and the strip in the sticky stack, and the caption after it', async () => {
    await open(390)
    const stick = document.querySelector('.stick')
    const mini = stick.querySelector('.minihero')
    expect(mini.getAttribute('aria-hidden')).toBe('true')
    expect(mini.querySelector('.mini-t').textContent).toBe('Men’s distance medley relay')
    expect(mini.querySelector('.mini-n').textContent).toBe('9:19.50')
    expect(mini.classList.contains('on')).toBe(false)
    expect(stick.querySelector('figure.race.card')).toBeTruthy()
    expect(stick.querySelector('figcaption')).toBeNull()
    expect(stick.nextElementSibling.matches('p.strip-cap')).toBe(true)
    expect(stick.nextElementSibling.textContent).toBe('Top 30 as one race. Meters are estimates.')
  })

  it('shows the one-line hero once the full hero has scrolled up behind the nav', async () => {
    let heroBottom = 500
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box() {
      if (this.classList?.contains('herocard')) return { top: heroBottom - 300, bottom: heroBottom, left: 0, right: 390, width: 390, height: 300 }
      if (this.matches?.('header.top')) return { top: 0, bottom: 60, left: 0, right: 390, width: 390, height: 60 }
      return real.call(this)
    })
    await open(390)
    const mini = document.querySelector('.minihero')
    await waitFor(() => expect(mini.classList.contains('on')).toBe(false))
    heroBottom = 20
    fireEvent.scroll(window)
    await waitFor(() => expect(mini.classList.contains('on')).toBe(true))
    heroBottom = 500
    fireEvent.scroll(window)
    await waitFor(() => expect(mini.classList.contains('on')).toBe(false))
  })

  it('leaves wider screens without the one-line hero or the split caption', async () => {
    await open(900)
    expect(document.querySelector('.minihero')).toBeNull()
    expect(document.querySelector('.strip-cap')).toBeNull()
    expect(document.querySelector('figure.race.card figcaption')).toBeTruthy()
    cleanup()
    vi.restoreAllMocks()
    await open(1440)
    expect(document.querySelector('.stick')).toBeNull()
    expect(document.querySelector('.minihero')).toBeNull()
  })
})

describe('the row picked by scrolling, where there is no hover', () => {
  it('picks the row whose middle is nearest the reading line, inside the free part of the screen', () => {
    const rows = [10, 11, 12, 13, 14].map((rank, index) => ({ rank, top: 300 + index * 60, bottom: 360 + index * 60 }))
    expect(readingLine(300, 844)).toBe(572)
    expect(nearestRow(rows, 572)).toBe(14)
    expect(nearestRow(rows, 455)).toBe(12)
    // On a tie the earlier row wins, so there is only ever one.
    expect(nearestRow(rows, 420)).toBe(11)
    // Rows hidden behind the sticky stack, or collapsed, don't count.
    expect(nearestRow(rows, 300, { from: 400 })).toBe(12)
    expect(nearestRow([{ rank: 3, top: 0, bottom: 0 }, ...rows], 0)).toBe(10)
    expect(nearestRow(rows, 500, { from: 900, to: 1000 })).toBeNull()
    expect(nearestRow([], 500)).toBeNull()
  })

  it('lifts the runner into a chip unless the leader or first one out already has one', () => {
    const placed = dots([1, 2, 12, 13, 20])
    const chips = chipDots(placed, 12)
    expect(liftedDot(placed, 20, chips)).toBe(placed[4])
    expect(liftedDot(placed, 1, chips)).toBeNull()
    expect(liftedDot(placed, 13, chips)).toBeNull()
    expect(liftedDot(placed, 12, chips)).toBe(placed[2])
    expect(liftedDot(placed, null, chips)).toBeNull()
    expect(liftedDot(placed, 99, chips)).toBeNull()
  })

  // jsdom has no layout: stack the rows 50px apart under a 60px nav and a strip ending at 300.
  function rowsAt(offset) {
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box() {
      if (this.matches?.('header.top')) return { top: 0, bottom: 60, left: 0, right: 390, width: 390, height: 60 }
      if (this.classList?.contains('stick')) return { top: 100, bottom: 300, left: 0, right: 390, width: 390, height: 200 }
      if (this.tagName === 'TR' && this.dataset.rank) {
        const top = Number(this.dataset.rank) * 50 - offset.value
        return { top, bottom: top + 50, left: 0, right: 390, width: 390, height: 50 }
      }
      return real.call(this)
    })
  }

  it('marks one row and lifts its runner into a 10px chip drawn last on the phone strip', async () => {
    const offset = { value: 0 }
    vi.stubGlobal('innerHeight', 844)
    rowsAt(offset)
    await open(390)
    // Nothing is picked before the reader scrolls.
    expect(document.querySelector('tr.act')).toBeNull()
    expect(document.querySelector('.scrollchip')).toBeNull()
    // Reading line: half way between 300 and 844 = 572; row 20's middle is 20 * 50 + 25 - 450 = 575.
    offset.value = 450
    fireEvent.scroll(window)
    await waitFor(() => expect([...document.querySelectorAll('tr.act')].map(row => row.dataset.rank)).toEqual(['20']))
    const svg = document.querySelector('figure.race.card svg')
    const lifted = svg.querySelector('.scrollchip')
    expect(lifted.dataset.rank).toBe('20')
    expect(Number(lifted.querySelector('.cd-back').getAttribute('r'))).toBe(10)
    expect(lifted.querySelector('.chip-in')).toBeTruthy()
    expect(svg.lastElementChild).toBe(lifted)
    expect(svg.querySelectorAll('.chipdot')).toHaveLength(3)
    // Scrolling on moves the one active row and the chip with it.
    offset.value = 250
    fireEvent.scroll(window)
    await waitFor(() => expect([...document.querySelectorAll('tr.act')].map(row => row.dataset.rank)).toEqual(['16']))
    expect([...svg.querySelectorAll('.scrollchip')].map(dot => dot.dataset.rank)).toEqual(['16'])
  })

  it('adds no second chip when the picked row is the first one out', async () => {
    const offset = { value: 0 }
    vi.stubGlobal('innerHeight', 844)
    rowsAt(offset)
    await open(390)
    // Row 13's middle: 13 * 50 + 25 - 103 = 572.
    offset.value = 103
    fireEvent.scroll(window)
    await waitFor(() => expect([...document.querySelectorAll('tr.act')].map(row => row.dataset.rank)).toEqual(['13']))
    const svg = document.querySelector('figure.race.card svg')
    expect(svg.querySelector('.scrollchip')).toBeNull()
    expect([...svg.querySelectorAll('.chipdot')].map(dot => dot.dataset.rank)).toEqual(['1', '13'])
  })

  it('leaves desktop hover alone: no row is picked by scrolling on wide screens with hover', async () => {
    const offset = { value: 0 }
    rowsAt(offset)
    await open(1440)
    offset.value = 450
    fireEvent.scroll(window)
    await new Promise(done => setTimeout(done, 50))
    expect(document.querySelector('tr.act')).toBeNull()
    expect(document.querySelector('.scrollchip')).toBeNull()
    expect(document.querySelector('[aria-live]')).toBeNull()
  })

  it('carries the qualifying line through the line holder\'s chip with a black ring', async () => {
    const offset = { value: 0 }
    vi.stubGlobal('innerHeight', 844)
    rowsAt(offset)
    await open(390)
    // Row 12's middle: 12 * 50 + 25 - 53 = 572.
    offset.value = 53
    fireEvent.scroll(window)
    await waitFor(() => expect(document.querySelector('.scrollchip')?.dataset.rank).toBe('12'))
    const chip = document.querySelector('.scrollchip')
    expect(chip.classList.contains('bub')).toBe(true)
    expect(chip.querySelector('.cd-outer')).toBeNull()
    expect(css).toMatch(/\.race \.dot\.bub\.scrollchip \.cd-ring\{stroke:#151515;stroke-width:3\}/)
  })

  it('scales the row with transform only, eases the chip in, and drops both for reduced motion', () => {
    expect(css).toMatch(/tr\.act \.tx,tr\.act td\.t \.mk\{transform:scale\(1\.05\)\}/)
    expect(css).toMatch(/tr\[data-rank\] \.tx,tr\[data-rank\] td\.t \.mk\{transition:transform 150ms var\(--ease\)\}/)
    expect(css).toMatch(/\.dot\.scrollchip \.chip-in\{animation:chip-in 150ms var\(--ease\) both\}/)
    const at = css.indexOf('@media (prefers-reduced-motion: reduce){')
    const reduced = css.slice(at, css.indexOf('\n}\n', at))
    expect(reduced).toMatch(/\.dot\.scrollchip \.chip-in\{animation:none\}/)
    expect(reduced).toMatch(/tr\[data-rank\] \.tx,tr\[data-rank\] td\.t \.mk\{transition:none\}/)
    expect(reduced).toMatch(/tr\.act \.tx,tr\.act td\.t \.mk\{transform:none\}/)
    // Only transforms move: the active row changes no size, margin or padding.
    const act = css.match(/tr\.act[^{]*\{[^}]*\}/g)
    expect(act.every(rule => !/(width|height|margin|padding|font-size)\s*:/.test(rule))).toBe(true)
  })
})

describe('the pinned strip closes with a band of page colour under it', () => {
  const phoneRules = () => {
    const at = css.lastIndexOf('@media (max-width: 720px){', css.indexOf('.stick{'))
    return css.slice(at, css.indexOf('\n}\n', at))
  }

  it('rounds the pinned card, pads it 12px more, and hangs a page-colour band below the stack only while pinned', () => {
    const rules = phoneRules()
    expect(rules).toMatch(/\.stick::before\{content:'';display:none;position:absolute;left:0;right:0;top:calc\(100% - 1px\);height:25px;background:linear-gradient\(to bottom,var\(--page\) 13px,transparent\)\}/)
    expect(rules).toMatch(/\.stick\.stuck::before\{display:block\}/)
    expect(rules).toMatch(/\.stick \.race\.card\{margin:0;padding-top:12px;padding-bottom:8px;border-radius:24px 24px 0 0\}/)
    expect(rules).toMatch(/\.stick\.stuck \.race\.card\{padding-bottom:20px;border-radius:24px\}/)
    // The 12px the pinned card grows by come back out of the hidden caption, so nothing below moves.
    expect(rules).toMatch(/\.stick\.stuck \+ \.strip-cap\{visibility:hidden;margin-top:-12px\}/)
    // The band is the page's own colour.
    expect(css).toMatch(/--page:#EDEBE6;/)
    expect(rules).toMatch(/\.stick\{[^}]*background:var\(--page\)\}/)
  })

  it('marks the stack as pinned once the strip reaches its spot, and nothing of the table sits between it and the band', async () => {
    let stickTop = 400
    const real = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box() {
      if (this.matches?.('header.top')) return { top: 0, bottom: 60, left: 0, right: 390, width: 390, height: 60 }
      if (this.classList?.contains('herocard')) return { top: stickTop - 312, bottom: stickTop - 12, left: 0, right: 390, width: 390, height: 300 }
      if (this.classList?.contains('stick')) return { top: stickTop, bottom: stickTop + 160, left: 0, right: 390, width: 390, height: 160 }
      return real.call(this)
    })
    await open(390)
    const stick = document.querySelector('.stick')
    await waitFor(() => expect(stick.classList.contains('stuck')).toBe(false))
    // jsdom gives the one-line hero no height, so the strip's spot is right under the 60px nav.
    stickTop = 60
    fireEvent.scroll(window)
    await waitFor(() => expect(stick.classList.contains('stuck')).toBe(true))
    // The band and the closing strip are drawn by the stack itself; the next things in the page are the
    // caption (hidden while pinned) and then the table card, never a row in between.
    expect(stick.nextElementSibling.matches('p.strip-cap')).toBe(true)
    expect(stick.nextElementSibling.nextElementSibling.matches('section.tablecard')).toBe(true)
    expect(stick.querySelector('tr, .finish')).toBeNull()
    stickTop = 400
    fireEvent.scroll(window)
    await waitFor(() => expect(stick.classList.contains('stuck')).toBe(false))
  })
})

describe('distance labels on the phone strip', () => {
  it('gives the distance with "behind" and "ahead" where it fits, and nothing rather than a bare word where it does not', () => {
    // A relay field where the round ticks on the behind side run into the edge.
    const rows = Array.from({ length: 50 }, (_, index) => ({ rank: index + 1, name: `Team ${index + 1}`, v: 181.6 + index * 0.12 }))
    const texts = width => {
      const layout = layoutStrip({ rows, lineV: rows[11].v, dist: 1600, rank: 12, width, radius: 4.5, phone: true })
      return { layout, all: [...layout.ticks, ...layout.ends].map(item => item.text) }
    }
    // 358 wide: both sides have room for a distance.
    const wide = texts(358).all
    expect(wide.some(text => /^\d+(\.\d)?\u2009m behind$/.test(text))).toBe(true)
    expect(wide.some(text => /^\d+(\.\d)?\u2009m ahead$/.test(text))).toBe(true)
    // 328 wide: the ahead side is too narrow for "11.6 m ahead", so it gets no label at all.
    const { layout, all } = texts(328)
    expect(328 - layout.lineX).toBeLessThan(12 * 7.2 + 12)
    expect(all.some(text => /^\d+(\.\d)?\u2009m behind$/.test(text))).toBe(true)
    expect(all.some(text => /ahead$/.test(text))).toBe(false)
    for (const width of [358, 328, 300, 260]) {
      for (const text of texts(width).all) expect(text).toMatch(/^\d+(\.\d)?\u2009m (behind|ahead)$/)
    }
  })

  it('shows "N m behind" on the phone strip', async () => {
    await open(390)
    const axis = [...document.querySelectorAll('figure.race.card svg > text')].map(node => node.textContent).filter(Boolean)
    expect(axis.some(text => /\d.*m behind$/.test(text))).toBe(true)
    expect(axis).not.toContain('behind')
  })
})

describe('a chip drawn away from its spot leaves no second ring', () => {
  it('hides plain dots that overlap a moved chip, and only those', () => {
    const placed = [
      { rank: 12, x: 100, y: 50 }, { rank: 13, x: 96, y: 56 }, { rank: 14, x: 84, y: 56 }, { rank: 15, x: 60, y: 56 },
    ]
    const moved = [{ dot: placed[1], x: 81.5, y: 56, reach: 13 }]
    expect([...coveredDots(placed, moved, 4.5)].map(dot => dot.rank)).toEqual([14])
    // Not moved: the chip sits on its own spot and nothing is hidden.
    expect(coveredDots(placed, [{ dot: placed[1], x: 96, y: 56, reach: 13 }], 4.5).size).toBe(0)
    // The chip's own runner is never in the list.
    expect(coveredDots(placed, moved, 100).has(placed[1])).toBe(false)
  })

  it('draws no plain dot for a chip runner and hides the dots under the moved first-one-out chip', async () => {
    const record = field()
    record.rankings[12].time = record.rankings[11].time
    record.rankings[13].time = record.rankings[11].time
    await open(390, { record })
    const svg = document.querySelector('figure.race.card svg')
    for (const chip of svg.querySelectorAll('.chipdot')) {
      expect(chip.querySelector('.pt')).toBeNull()
      expect(svg.querySelectorAll(`.dot[data-rank="${chip.dataset.rank}"]`)).toHaveLength(1)
    }
    // The first one out's chip is drawn clear of the line; no plain dot left visible overlaps it.
    const at = node => node.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number)
    const chip = svg.querySelector('.chipdot[data-rank="13"]')
    const [cx, cy] = at(chip)
    const lineX = Number(svg.querySelector('.fl line').getAttribute('x1'))
    expect(cx).toBeLessThan(lineX - 13)
    const visible = [...svg.querySelectorAll('.dot:not(.chipdot):not(.under)')]
    expect(visible.every(dot => {
      const [x, y] = at(dot)
      return Math.hypot(x - cx, y - cy) >= 13 + 4.5
    })).toBe(true)
    expect([...svg.querySelectorAll('.dot.under')].every(dot => !dot.classList.contains('chipdot'))).toBe(true)
    expect(css).toMatch(/\.dot\.under\{visibility:hidden\}/)
  })
})

describe('round 23: the band, the seam, the fade, the scaled words and the readout', () => {
  const phoneRules = () => {
    const at = css.lastIndexOf('@media (max-width: 720px){', css.indexOf('.stick{'))
    return css.slice(at, css.indexOf('\n}\n', at))
  }
  const px = (rule, prop) => {
    const match = rule.match(new RegExp(`${prop}:([^;}]+)`))
    return match ? match[1] : null
  }

  it('fills behind the pinned card and its rounded corners full width, and overlaps the band by a pixel', () => {
    const rules = phoneRules()
    const stick = rules.match(/\.stick\{[^}]*\}/)[0]
    const band = rules.match(/\.stick::before\{[^}]*\}/)[0]
    // The stack is a full-width rectangle of page colour; the card, and its corners, sit on it.
    expect(px(stick, 'margin')).toBe('0 -16px')
    expect(px(stick, 'background')).toBe('var(--page)')
    expect(rules).toMatch(/\.stick\.stuck \.race\.card\{[^}]*border-radius:24px[^}]*\}/)
    // The band continues the same rectangle down, full width, starting a pixel inside the stack.
    expect(px(band, 'left')).toBe('0')
    expect(px(band, 'right')).toBe('0')
    expect(px(band, 'top')).toBe('calc(100% - 1px)')
    // Solid for BAND px below the stack (plus the pixel of overlap), then a FADE px fade to transparent.
    const solid = Number(band.match(/var\(--page\) (\d+)px/)[1])
    expect(solid - 1).toBe(BAND)
    expect(parseFloat(px(band, 'height')) - solid).toBe(FADE)
    expect(band).toMatch(/transparent\)/)
  })

  it('starts looking for the active row below the band and its fade when the strip is pinned', () => {
    expect(BAND).toBe(12)
    expect(FADE).toBe(12)
    expect(freeTop(60, 271, true)).toBe(271 + 24)
    expect(freeTop(60, 271, false)).toBe(271)
    expect(freeTop(60, undefined, true)).toBe(60)
    const top = freeTop(60, 271, true)
    const rows = [{ rank: 16, top: 262, bottom: 322 }, { rank: 17, top: 322, bottom: 382 }, { rank: 20, top: 540, bottom: 600 }]
    // Row 16's middle (292) sits in the band's fade: it can never be the active row.
    expect(nearestRow(rows, 0, { from: top, to: 844 })).toBe(17)
    expect(readingLine(top, 844)).toBeGreaterThan(top)
  })

  it('scales only the words of the active row, never the row or a cell with its background', async () => {
    const rules = css.match(/[^{}\n]*\{[^{}]*transform:scale\([^{}]*\}/g).filter(rule => /\.act/.test(rule))
    expect(rules).toEqual(['tr.act .tx,tr.act td.t .mk{transform:scale(1.05)}'])
    expect(css).not.toMatch(/tr\.act td\.ath\{[^}]*transform/)
    await open(390)
    const row = document.querySelector('tbody tr[data-rank="13"]')
    expect(row.querySelector('td.ath > span.tx')).toBeTruthy()
    expect(row.querySelector('td.ath').textContent).toBe('School 13')
    const record = field()
    record.rankings.forEach(entry => { entry.athlete = `Runner, ${entry.rank}` })
    record.qualification.is_relay = false
    record.event = 'Mile'
    cleanup()
    await open(390, { record, url: '/?s=indoor&g=m&event=mile' })
    const solo = document.querySelector('tbody tr[data-rank="13"]')
    expect(solo.querySelector('td.ath > span.tx')).toBeTruthy()
    expect(solo.querySelector('td.team > span.tl.tx')).toBeTruthy()
  })

  it('shortens the strip readout to "M. Endrody", flips it, and never cuts it off', () => {
    expect(readoutNames('Endrody, Matthew')).toEqual(['M. Endrody', 'Endrody'])
    expect(readoutNames('Oregon (B)')).toEqual(['Oregon (B)'])
    expect(readoutNames('N/A')).toEqual([])
    // About the width of 14px Archivo semibold per character.
    const measure = text => text.length * 6.5
    const parts = (name, keep) => `14. ${name}${keep.mark ? ' · 3:53.65@' : ''}${keep.tail ? ' · 1.7 m ahead' : ''}`
    const inside = (fit, width) => {
      const w = measure(parts(fit.name, fit))
      const [a, b] = fit.anchor === 'start' ? [fit.x, fit.x + w] : fit.anchor === 'end' ? [fit.x - w, fit.x] : [fit.x - w / 2, fit.x + w / 2]
      return a >= 4 && b <= width - 4
    }
    // Right of centre on a phone strip: the centred label would run off, so it flips to end at the dot.
    const right = fitReadout({ x: 260, width: 358, names: readoutNames('Endrody, Matthew'), parts, measure })
    expect(right.name).toBe('M. Endrody')
    expect(right.anchor).toBe('end')
    expect(right.tail && right.mark).toBe(true)
    expect(inside(right, 358)).toBe(true)
    // Too narrow for the initial: the surname alone.
    const tight = fitReadout({ x: 140, width: 270, names: readoutNames('Endrody, Matthew'), parts, measure })
    expect(tight.name).toBe('Endrody')
    expect(inside(tight, 270)).toBe(true)
    for (const fit of [right, tight]) expect(parts(fit.name, fit)).not.toMatch(/…|\.\.\./)
  })
})

describe('no hover where scrolling picks the row', () => {
  it('ignores a pointer resting over rows on phones, but a tap still shows the runner on the strip', async () => {
    await open(390)
    const row = document.querySelector('tbody tr[data-rank="14"]')
    fireEvent.pointerEnter(row)
    expect(row.classList.contains('on')).toBe(false)
    expect(document.querySelector('figure.race.card').classList.contains('reading')).toBe(false)
    fireEvent.focus(row)
    await waitFor(() => expect(document.querySelector('figure.race.card').classList.contains('reading')).toBe(true))
    expect(document.querySelector('figure.race.card .readout').textContent).toMatch(/^14\. School 14/)
  })

  it('keeps pointer hover on wide screens', async () => {
    await open(1440)
    const row = document.querySelector('tbody tr[data-rank="14"]')
    fireEvent.pointerEnter(row)
    await waitFor(() => expect(document.querySelector('.rail .dot[data-rank="14"]').classList.contains('on')).toBe(true))
  })
})
