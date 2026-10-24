import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Mark } from '../src/components/Mark'
import PastYears from '../src/components/PastYears'
import { FLAG_COPY, FOOTNOTE, rawMark } from '../src/utils/format'

function mountStyles() {
  if (document.getElementById('app-css')) return
  const style = document.createElement('style')
  style.id = 'app-css'
  style.textContent = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  document.head.appendChild(style)
}

function season(overrides) {
  return {
    season: 'indoor',
    region: 'National',
    gender: 'm',
    event: 'Mile',
    year: '2025-2026',
    rank: 16,
    place: 16,
    of: 16,
    mark: '3:58.12',
    athlete: 'Runner, Ada',
    team: 'School',
    v: 238.12,
    rule: 'line',
    comparable: true,
    note: null,
    flag: null,
    converted: null,
    conversion: null,
    raw: null,
    tie: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('conversion mark', () => {
  it('keeps the panel inside the table column, off the race strip beside it', () => {
    // A 600px table column with the strip to its right; the @ sits 40px from the column's edge.
    const rects = {
      'split-sheet': { left: 0, right: 600, top: 0, bottom: 900 },
      flag: { left: 560, right: 572, top: 100, bottom: 120 },
      'sym-btn': { left: 560, right: 572, top: 100, bottom: 120 },
    }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function box() {
      if (this.classList.contains('pop')) {
        const left = rects.flag.left + parseFloat(this.style.left || '0')
        const top = rects.flag.top + parseFloat(this.style.top || '0')
        return { left, right: left + 280, top, bottom: top + 42, width: 280, height: 42 }
      }
      const key = Object.keys(rects).find(name => this.classList.contains(name))
      const r = rects[key] || { left: 0, right: 0, top: 0, bottom: 0 }
      return { ...r, width: r.right - r.left, height: r.bottom - r.top }
    })
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<div className="split-sheet"><Mark text="3:51.73" conversion="altitude" hang /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'converted for altitude' }))
    const pop = document.querySelector('.pop')
    const box = pop.getBoundingClientRect()
    expect(box.right).toBeLessThanOrEqual(600)
    expect(box.left).toBeGreaterThanOrEqual(12)
    expect(parseFloat(pop.style.top)).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })


  it('reads a raw mark only from the recorded conversion note', () => {
    expect(rawMark('Converted from 4:04.44 for Altitude')).toBe('4:04.44')
    expect(rawMark('Converted from 21.32 for Track Size')).toBe('21.32')
    expect(rawMark('Converted from 7.28 for Altitude. Converted from 7.28 (55 High Hurdles)')).toBe('7.28')
    expect(rawMark('Converted from 4.2m for Hand-Time')).toBe('4.2m')
    expect(rawMark('Converted from a 55m track')).toBeNull()
    expect(rawMark(null)).toBeNull()
  })

  it('puts the symbol after the mark and names it without relying on the symbol', () => {
    render(
      <p>
        <Mark text={'2.20\u00A0m'} conversion="altitude" interactive={false} />
        <Mark text="7.82" conversion="flat" />
        <Mark text="9:28.61" conversion="both" raw="9:31.00" />
      </p>,
    )
    expect(document.body.textContent).toContain('2.20\u00A0m@')
    expect(document.body.textContent).toContain('7.82#')
    expect(document.body.textContent).toContain('9:28.61#@')
    expect(screen.getByText('converted for altitude')).toBeTruthy()
    const flat = screen.getAllByRole('button', { name: /converted for a flat or oversized track/ })
    const altitude = screen.getByRole('button', { name: /converted for altitude/ })
    expect(flat.map(button => button.textContent)).toEqual(['#', '#@'])
    expect(altitude.textContent).toBe('#@')
  })

  it('opens the flat and altitude notes, and leaves the raw line off when the data has none', () => {
    render(<Mark text="6.57" conversion="altitude" />)
    fireEvent.click(screen.getByRole('button', { name: 'converted for altitude' }))
    const altitudeNote = screen.getByText(FLAG_COPY['@'])
    expect(altitudeNote.textContent).toBe(`@ ${FLAG_COPY['@']}`)
    expect(altitudeNote.querySelector('.sym').textContent).toBe('@')
    expect(screen.queryByText(/Raw mark/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'converted for altitude' }))
    expect(screen.queryByText(FLAG_COPY['@'])).toBeNull()

    render(<Mark text="45.27" conversion="flat" />)
    fireEvent.click(screen.getByRole('button', { name: 'converted for a flat or oversized track' }))
    const flatNote = screen.getByText(FLAG_COPY['#'])
    expect(flatNote.textContent).toBe(`# ${FLAG_COPY['#']}`)
    expect(flatNote.querySelector('.sym').textContent).toBe('#')
    expect(screen.queryByText(/Raw mark/)).toBeNull()
  })

  it('draws the popover in a panel and closes it with Esc or a click outside', () => {
    mountStyles()
    render(<Mark text="9:28.61" conversion="both" />)
    const button = screen.getByRole('button', { name: /converted for altitude/ })
    fireEvent.click(button)
    const pop = document.querySelector('.pop')
    const style = getComputedStyle(pop)
    const rule = [...document.getElementById('app-css').sheet.cssRules].find(item => item.selectorText === '.pop')
    const lines = [...pop.children]
    expect(pop.getAttribute('role')).toBe('note')
    expect(lines.map(node => node.textContent)).toEqual([`# ${FLAG_COPY['#']}`, `@ ${FLAG_COPY['@']}`])
    expect(lines.map(node => node.querySelector('.sym').textContent)).toEqual(['#', '@'])
    expect(style.position).toBe('absolute')
    expect(style.maxWidth).toBe('280px')
    expect(parseFloat(style.paddingTop)).toBeGreaterThan(0)
    expect(rule.style.background).toBe('var(--bg)')
    expect(rule.style.border).toBe('1px solid var(--ink)')
    expect(rule.style.padding).toBe('10px 12px')
    expect(rule.style.maxWidth).toBe('280px')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.pop')).toBeNull()

    fireEvent.click(button)
    expect(document.querySelector('.pop')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(document.querySelector('.pop')).toBeNull()
  })

  it('reserves the symbol slot when a column mark has no flag', () => {
    mountStyles()
    const view = render(<Mark text="9:16.98" hang />)
    const slot = view.container.querySelector('.mk-slot')
    const rule = [...document.getElementById('app-css').sheet.cssRules].find(item => item.selectorText === '.mk-slot')
    expect(slot).toBeTruthy()
    expect(slot.textContent).toBe('')
    expect(rule.style.width).toBe('1.3em')
    expect(getComputedStyle(slot).width).not.toBe('0px')
  })

  it('adds the recorded raw mark when the popover opens', () => {
    render(<Mark text="3:59.17" conversion="altitude" raw="4:04.44" />)
    fireEvent.click(screen.getByRole('button', { name: 'converted for altitude' }))
    expect(screen.getByText(FLAG_COPY['@']).textContent).toBe(`@ ${FLAG_COPY['@']}`)
    expect(screen.getByText('Raw mark: 4:04.44.')).toBeTruthy()
  })

  it('shows the footnote text only as the season legend, and keeps a converted dot filled', () => {
    const flagged = season({ conversion: 'altitude', flag: '@', raw: null })
    const older = season({
      year: '2024-2025',
      mark: '4:01.00',
      v: 241,
      conversion: 'flat',
      flag: '#',
      converted: 'Converted from 4:02.10 for Track Size',
      raw: '4:02.10',
    })
    const view = render(<PastYears lines={[flagged, older]} kind="time" currentYear="2025-2026" />)
    const label = view.container.querySelector('svg.dk text.now')
    expect(label.textContent).toContain('3:58.12@')
    expect(label.querySelector('tspan.sym').textContent).toBe('@')
    expect(view.container.querySelector('svg.dk circle.now').getAttribute('class')).toBe('now')
    expect(view.container.querySelector('circle.old')).toBeNull()
    const current = [...view.container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('2025–26'))
    expect(current.querySelector('td.t').textContent).toContain('3:58.12@')
    expect(current.textContent).toContain('Mark converted for altitude by TFRRS')
    expect(current.textContent).not.toContain('Raw mark')
    expect(current.textContent).not.toContain('Converted for altitude by TFRRS.')
    fireEvent.click(current.querySelector('button'))
    expect(view.getByText(FLAG_COPY['@']).textContent).toBe(`@ ${FLAG_COPY['@']}`)
    expect(document.querySelector('.pop').textContent).not.toMatch(/Raw mark/)

    const flat = [...view.container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('2024–25'))
    expect(flat.querySelector('td.t').textContent).toContain('4:01.00#')
    expect(flat.textContent).toContain('Mark converted for a flat track by TFRRS')
    expect(flat.textContent).toContain('Raw mark: 4:02.10')
    expect(flat.textContent).not.toContain('Converted from 4:02.10 for Track Size by TFRRS.')
    fireEvent.click(flat.querySelector('button'))
    expect(view.getByText(FLAG_COPY['#']).textContent).toBe(`# ${FLAG_COPY['#']}`)
    expect(view.getByText('Raw mark: 4:02.10.')).toBeTruthy()
    expect(view.container.textContent).not.toContain(FOOTNOTE)
  })

  it('keeps a standards-era converted mark hollow and quiet under the athlete', () => {
    const lines = [
      season(),
      season({
        year: '2009-2010',
        mark: '3:59.17',
        v: 239.17,
        rule: 'standards',
        comparable: false,
        conversion: 'altitude',
        flag: '@',
        converted: 'Converted from 4:04.44 for Altitude',
        raw: '4:04.44',
      }),
    ]
    const view = render(<PastYears lines={lines} kind="time" currentYear="2025-2026" />)
    fireEvent.click(view.getByRole('button', { name: /Show all/ }))
    expect(view.container.querySelector('circle.old')).toBeTruthy()
    expect(view.container.querySelector('circle.now').getAttribute('class')).toBe('now')
    const row = [...view.container.querySelectorAll('tr.old')].find(item => item.textContent.includes('2009–10'))
    expect(row.textContent).toContain('Mark converted for altitude by TFRRS')
    expect(row.textContent).toContain('Raw mark: 4:04.44')
    expect(row.textContent).toContain('3:59.17@')
    fireEvent.click(row.querySelector('button'))
    expect(view.getByText('Raw mark: 4:04.44.')).toBeTruthy()
    expect(view.getByText(FLAG_COPY['@']).textContent).toBe(`@ ${FLAG_COPY['@']}`)
  })
})
