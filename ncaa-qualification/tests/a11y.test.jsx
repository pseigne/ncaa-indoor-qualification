import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { fetched, savedSite, serveSite, siteFiles } from './site'

// A men's indoor mile with the line at 16: 3:53.00, 3:53.25, ... a quarter second apart.
function mile(count = 24, rank = 16) {
  const rankings = Array.from({ length: count }, (_, index) => {
    const seconds = 53 + index * 0.25
    return { rank: index + 1, athlete: `Runner ${index + 1}`, team: `School ${index + 1}`, time: `3:${seconds.toFixed(2)}` }
  })
  return {
    year: '2025-2026',
    event: 'Mile',
    season: 'indoor',
    region: 'National',
    gender: 'm',
    rankings,
    qualification: { rank, is_relay: false, status: 'available', entry: { ...rankings[rank - 1] } },
  }
}

// The same field as an 800m, so the picker has a second event to choose.
function eight() {
  const record = mile()
  const rankings = record.rankings.map(row => ({ ...row, time: `1:${(46 + (row.rank - 1) * 0.1).toFixed(2)}` }))
  return { ...record, event: '800 Meters', rankings, qualification: { ...record.qualification, entry: { ...rankings[15] } } }
}

function serve(records) {
  serveSite(siteFiles(records))
}

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

// The rules of one @media block, by its exact query.
function block(query) {
  const start = css.indexOf(`@media ${query}{`)
  if (start < 0) return ''
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}' && --depth === 0) return css.slice(start, index + 1)
  }
  return ''
}

const saved = savedSite()

// The saved lists, with their daily history, so the line has a Feb 1 mark to press and hold for.
function serveSaved() {
  serveSite(saved)
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
  // The standing strip sizes itself from its plot box, which jsdom does not lay out.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function size() {
    return this.classList.contains('plot') ? 400 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function size() {
    return this.classList.contains('plot') ? 700 : 0
  })
}

async function open(width, { records = [mile()], url = '/?s=indoor&g=m&event=mile' } = {}) {
  screenAt(width)
  window.history.replaceState(null, '', url)
  serve(records)
  render(<App />)
  await screen.findByText('16', { selector: 'tr.bubble .pl' })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('names start with the visible words', () => {
  it('names the brand link by the title that is showing', async () => {
    await open(1440)
    expect(screen.getByRole('link', { name: 'NCAA TF Qualification Monitor' })).toBeTruthy()
    cleanup()
    await open(390)
    const link = screen.getByRole('link', { name: 'NCAA TF Qualification Monitor' })
    expect(link.hasAttribute('aria-label')).toBe(false)
    expect(link.querySelector('.mark-full').getAttribute('aria-hidden')).toBe('true')
    expect(link.querySelector('.mark-short').hasAttribute('aria-hidden')).toBe(false)
  })

  it('names an event link by its label and line, not the full event name', async () => {
    await open(1440)
    const nav = screen.getByRole('navigation', { name: 'Events' })
    const link = nav.querySelector('a[aria-current="page"]')
    expect(link.getAttribute('aria-label')).toBe('Mile, 3:56.75')
    expect(link.textContent).toContain('Mile')
    expect(link.textContent).toContain('3:56.75')
  })

  it('names the qualifying line button by its words', async () => {
    await open(1440)
    const finish = document.getElementById('finish')
    expect(finish.textContent).toBe('Qualifying line · top 16 go to nationals First one out is 0.25s back')
    expect(finish.getAttribute('aria-label')).toBe('Qualifying line, top 16 go to nationals, first one out is 0.25s back.')
  })

  it('keeps the press and hold sentence after the visible words when there is a Feb 1 line', async () => {
    screenAt(1440)
    window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile')
    serveSaved()
    render(<App />)
    const finish = await screen.findByRole('button', { name: /^Qualifying line, top 16 go to nationals, / })
    const words = finish.querySelector('.why').textContent
    expect(finish.getAttribute('aria-label')).toMatch(/\. Press and hold to see where the Feb 1 line would sit today\.$/)
    expect(finish.getAttribute('aria-label').toLowerCase()).toContain(words.toLowerCase())
  })
})

describe('rows say in or out', () => {
  it('adds the status and the gap to the line to each row name', async () => {
    await open(1440)
    const name = rank => document.querySelector(`tr[data-rank="${rank}"]`).getAttribute('aria-label')
    expect(name(15)).toBe('15. Runner 15, School 15, 3:56.50, in, 0.25s ahead of the line')
    expect(name(16)).toBe('16. Runner 16, School 16, 3:56.75, in, on the line')
    expect(name(17)).toBe('17. Runner 17, School 17, 3:57.00, out, 0.25s behind the line')
    expect(name(20)).toBe('20. Runner 20, School 20, 3:57.75, out, 1.00s behind the line')
  })

  it('calls a mark level with the line a tie, in or out', async () => {
    const record = mile()
    record.rankings[16].time = record.rankings[15].time
    await open(1440, { records: [record] })
    expect(document.querySelector('tr[data-rank="17"]').getAttribute('aria-label')).toBe('17. Runner 17, School 17, 3:56.75, out, level with the line')
  })
})

describe('44px tap targets that look the same', () => {
  it('centres a 44px hit area on the conversion symbol without growing the symbol', () => {
    expect(css).toMatch(/\.sym-btn\{padding:0;margin:0\}/)
    expect(css).toContain(".sym-btn::after{content:'';position:absolute;left:50%;top:50%;width:max(100%,44px);height:max(100%,44px);transform:translate(-50%,-50%)}")
  })

  it('keeps the symbol hit area inside its 40px row from 721px, so it never reaches the next row', () => {
    const rows = [...css.matchAll(/@media \(min-width: 721px\)\{ ([^}]*\}) \}/g)].map(match => match[1])
    expect(rows).toContain('tbody tr[data-rank] td.t .sym-btn::after{top:-10px;height:39px;transform:translateX(-50%)}')
    expect(css).toMatch(/\ntd\{padding:0 12px;height:40px;/)
  })

  it('makes the phone brand link 44px tall and gives the 4px back so the nav keeps its height', () => {
    expect(block('(max-width: 720px)')).toContain('.top .mark{font-size:17px;min-height:44px;margin:-2px 0}')
    expect(css).toMatch(/\.mark\{[^}]*min-height:44px/)
  })

  it('gives short board event links a 44px wide hit area that does not move the note beside them', () => {
    expect(css).toContain('.board td.ev a{position:relative;text-decoration:none;display:inline-flex;align-items:center;min-height:44px}')
    expect(css).toContain(".board td.ev a::after{content:'';position:absolute;left:50%;top:0;bottom:0;width:max(100%,44px);transform:translateX(-50%)}")
    expect(css).not.toMatch(/\.board td\.ev a\{[^}]*(min-width|padding)/)
  })
})

describe('the board table', () => {
  it('names every column, the team column with a visually hidden label', async () => {
    screenAt(1440)
    window.history.replaceState(null, '', '/?s=indoor&g=m&view=board')
    serve([mile()])
    render(<App />)
    const table = await screen.findByRole('table', { name: 'Every qualifying line' })
    const heads = [...table.querySelectorAll('thead th')]
    expect(heads.map(th => th.textContent)).toEqual(['Event', 'Line', 'Held by', 'Team', 'Since Feb 1', 'Season, faster ↑'])
    expect(heads[3].querySelector('.vh').textContent).toBe('Team')
    expect(table.querySelector('tbody td.team').textContent).toBe('School 16')
  })
})

describe('the keyboard', () => {
  const rows = () => [...document.querySelectorAll('tbody tr[data-rank]')]
  const stops = () => rows().filter(row => row.tabIndex === 0).map(row => Number(row.dataset.rank))
  const row = rank => document.querySelector(`tbody tr[data-rank="${rank}"]`)

  it('offers a skip link first that lands on the rows\' tab stop', async () => {
    await open(1440)
    const skip = screen.getByRole('link', { name: 'Skip to the list' })
    expect(document.body.querySelector('a, button')).toBe(skip)
    expect(skip.getAttribute('href')).toBe('#list')
    expect(document.getElementById('list').tagName).toBe('TABLE')
    fireEvent.click(skip)
    expect(document.activeElement).toBe(row(1))
  })

  it('hides the skip link until it has focus', () => {
    expect(css).toMatch(/\.skip\{position:fixed;[^}]*transform:translateY\(calc\(-100% - 16px\)\)\}/)
    expect(css).toContain('.skip:focus{transform:none}')
  })

  it('skips to the board table, which takes focus without becoming a tab stop', async () => {
    screenAt(1440)
    window.history.replaceState(null, '', '/?s=indoor&g=m&view=board')
    serve([mile()])
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Skip to the list' }))
    const table = document.getElementById('list')
    expect(table.classList.contains('board')).toBe(true)
    expect(table.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(table)
  })

  it('makes the rows one tab stop and moves through them with the arrows, Home and End', async () => {
    await open(1440)
    await waitFor(() => expect(document.querySelector('.rail .dot[data-rank="1"]')).toBeTruthy())
    const dotOn = rank => document.querySelector(`.rail .dot[data-rank="${rank}"]`).classList.contains('on')
    expect(stops()).toEqual([1])
    act(() => row(1).focus())
    expect(dotOn(1)).toBe(true)
    fireEvent.keyDown(row(1), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row(2))
    expect(stops()).toEqual([2])
    expect(dotOn(2)).toBe(true)
    expect(dotOn(1)).toBe(false)
    fireEvent.keyDown(row(2), { key: 'End' })
    const last = Number(rows().at(-1).dataset.rank)
    expect(document.activeElement).toBe(row(last))
    expect(stops()).toEqual([last])
    fireEvent.keyDown(row(last), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row(last))
    fireEvent.keyDown(row(last), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(row(last - 1))
    fireEvent.keyDown(row(last - 1), { key: 'Home' })
    expect(document.activeElement).toBe(row(1))
    expect(stops()).toEqual([1])
  })

  it('keeps the buttons in and under the table reachable by Tab', async () => {
    const record = mile()
    record.rankings[13].time = `${record.rankings[13].time} @`
    await open(390, { records: [record] })
    for (const name of [/^Show places 1/, /^Qualifying line/, /altitude/, /^Show all/]) {
      const button = screen.getAllByRole('button', { name }).find(item => item.closest('main'))
      expect(button.tabIndex).toBe(0)
    }
  })

  it('takes the tab stop to a row picked by tap or from the strip', async () => {
    await open(1440)
    act(() => row(17).focus())
    expect(stops()).toEqual([17])
    expect(document.activeElement).toBe(row(17))
  })
})

describe('the phone event dialog', () => {
  const picker = () => document.querySelector('main h1 button.picker')
  const dialog = () => document.querySelector('dialog.sheet')

  async function openSheet(width = 390, url) {
    await open(width, { records: [mile(), eight()], ...(url ? { url } : {}) })
    fireEvent.click(picker())
    expect(dialog().open).toBe(true)
    expect(dialog().contains(document.activeElement)).toBe(true)
  }

  it('gives focus back to the new page\'s picker button after a choice', async () => {
    await openSheet()
    fireEvent.click(dialog().querySelector('.events a[href*="event=800m"]'))
    await screen.findByText('1:47.50', { selector: 'tr.bubble .mk-n' })
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(picker())
    expect(picker().getAttribute('aria-label')).toMatch(/Now: Men’s 800m/)
  })

  it('gives focus to the board\'s picker button when the choice changes the view', async () => {
    await openSheet()
    fireEvent.click(dialog().querySelector('.board-link'))
    await screen.findByRole('table', { name: 'Every qualifying line' })
    expect(document.activeElement).toBe(picker())
    expect(picker().textContent).toBe('Every qualifying line')
  })

  it('gives focus to the new page\'s heading when it has no picker button', async () => {
    await openSheet(1200)
    fireEvent.click(dialog().querySelector('.board-link'))
    await screen.findByRole('table', { name: 'Every qualifying line' })
    const heading = document.querySelector('main h1')
    expect(heading.querySelector('button')).toBeNull()
    expect(document.activeElement).toBe(heading)
    expect(heading.tabIndex).toBe(-1)
  })

  it('closes on Escape and on Close, and returns focus to the picker button', async () => {
    await openSheet()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(picker())
    fireEvent.click(picker())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(picker())
  })

  it('keeps Tab inside the sheet while it is open', async () => {
    await openSheet()
    const stops = [...dialog().querySelectorAll('a[href], button')]
    act(() => stops.at(-1).focus())
    fireEvent.keyDown(stops.at(-1), { key: 'Tab' })
    expect(document.activeElement).toBe(stops[0])
    fireEvent.keyDown(stops[0], { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(stops.at(-1))
  })
})

describe('when the lists fail to load', () => {
  // Requests for the index and the shown list, the files a failure is about.
  const listFetches = () => fetched().filter(name => name === 'index.json' || name.startsWith('indoor-')).length

  // Fails `names` until `failing` is cleared, either with a 404 or a network error.
  function serveFlaky(how, names) {
    const state = { failing: true }
    serveSite(siteFiles([mile()]), { fail: name => (state.failing && names.includes(name) ? how : null) })
    return state
  }

  // The index and the shown list each fail on their own: how many of their requests a failure takes.
  describe.each([
    ['the index', ['index.json'], 1],
    ['the shown list', ['indoor-2025-2026-m-National.json'], 2],
  ])('when %s fails', (_, names, requests) => {
    it.each(['404', 'network'])('says so in a status region and loads on Try again after a %s', async how => {
      screenAt(390)
      window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile')
      const state = serveFlaky(how, names)
      render(<App />)
      const status = screen.getByRole('status')
      expect(status.textContent).toBe('Loading the qualifying lists…')
      await waitFor(() => expect(status.textContent).toBe('The qualifying lists could not be loaded.'))
      expect(screen.getAllByRole('status')).toHaveLength(1)
      const retry = screen.getByRole('button', { name: 'Try again' })
      expect(status.contains(retry)).toBe(false)
      expect(listFetches()).toBe(requests)

      state.failing = false
      act(() => retry.focus())
      fireEvent.click(retry)
      expect(screen.getByRole('status').textContent).toBe('Loading the qualifying lists…')
      expect(retry.getAttribute('aria-disabled')).toBe('true')
      expect(document.activeElement).toBe(retry)
      await screen.findByText('16', { selector: 'tr.bubble .pl' })
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()
      expect(document.activeElement).toBe(document.querySelector('main h1 button.picker'))
    })

    it('offers Try again again when the retry fails too, without losing focus', async () => {
      screenAt(1440)
      window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile')
      serveFlaky('404', names)
      render(<App />)
      const retry = await screen.findByRole('button', { name: 'Try again' })
      act(() => retry.focus())
      fireEvent.click(retry)
      await waitFor(() => expect(retry.hasAttribute('aria-disabled')).toBe(false))
      expect(screen.getByRole('status').textContent).toBe('The qualifying lists could not be loaded.')
      expect(document.activeElement).toBe(retry)
      // Only the failed file is asked for again.
      expect(listFetches()).toBe(requests + 1)
    })
  })
})
