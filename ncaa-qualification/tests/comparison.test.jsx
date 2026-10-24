import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '../src/App'
import { comparisonSeries, comparisonStart, pickComparison } from '../src/utils/comparison'
import { buildEvents } from '../src/utils/model'
import { savedFile, savedSite, serveSite, siteFiles } from './site'

const point = (d, v, n) => ({ d, v, n })

describe('which saved line the event page and the board compare against', () => {
  const series = (sizes) => [
    point('2026-01-15', 665.29, sizes[0]), point('2026-01-20', 560, sizes[1]), point('2026-02-01', 559, sizes[2]),
    point('2026-02-03', 558.5, sizes[3]), point('2026-03-01', 559, sizes[4]),
  ]

  it('starts on Feb 1 of the season when that list is longer than the qualifying spot', () => {
    expect(comparisonStart('2025-2026')).toBe('2026-02-01')
    expect(comparisonStart('2026')).toBe('2026-02-01')
    const chosen = pickComparison(series([12, 20, 20, 20, 20]), { rank: 12, year: '2025-2026' })
    expect(chosen).toEqual(point('2026-02-01', 559, 20))
    expect(comparisonSeries(series([12, 20, 20, 20, 20]), chosen).map(item => item.d)).toEqual(['2026-02-01', '2026-02-03', '2026-03-01'])
  })

  it('moves on when the Feb 1 list holds no more marks than the qualifying spot', () => {
    expect(pickComparison(series([50, 50, 12, 13, 20]), { rank: 12, year: '2025-2026' }).d).toBe('2026-02-03')
    expect(pickComparison(series([50, 50, 16, 16, 20]), { rank: 16, year: '2025-2026' }).d).toBe('2026-03-01')
  })

  it('gives nothing when no list from Feb 1 passes, or when sizes are unknown', () => {
    expect(pickComparison(series([50, 50, 12, 8, 12]), { rank: 12, year: '2025-2026' })).toBeNull()
    expect(pickComparison(series([null, null, null, null, null]), { rank: 12, year: '2025-2026' })).toBeNull()
    expect(pickComparison(series([20, 20, 20, 20, 20]), { rank: null, year: '2025-2026' })).toBeNull()
    expect(pickComparison([point('2026-02-01', null, 20), point('2026-02-02', 559, 20)], { rank: 12, year: '2025-2026' }).d).toBe('2026-02-02')
    expect(comparisonSeries(series([20, 20, 20, 20, 20]), null)).toEqual([])
  })
})

describe('the saved men’s DMR', () => {
  it('skips the twelve-team January lists and compares with the first full list from Feb 1', () => {
    const year = '2025-2026'
    const events = buildEvents(savedFile('indoor-2025-2026-m-National.json'))
    const dmr = events.find(event => event.name === 'Distance Medley Relay')
    const points = dmr.series.filter(item => Number.isFinite(item.v))
    expect(dmr.line.rank).toBe(12)
    expect(points[0]).toMatchObject({ d: '2026-01-15', n: 12 })
    const chosen = pickComparison(points, { rank: dmr.line.rank, year })
    expect(chosen.d).toBe('2026-02-01')
    expect(chosen.n).toBeGreaterThan(12)
    for (const earlier of points.filter(item => item.d >= '2026-02-01' && item.d < chosen.d)) expect(earlier.n).toBeLessThanOrEqual(12)
  })
})

const fixtures = JSON.parse(execFileSync('python3', [resolve(process.cwd(), '../tests/qualification_fixtures.py')], { encoding: 'utf8' }))

// The relay fixture with saved days: [time, date] pairs and how many marks each day's list held.
function relayWith(dates, sizes) {
  return { ...fixtures.relay.record, series: dates.map(([time, date], index) => [date, time, sizes[index]]) }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('the comparison line on the event page', () => {
  const dates = [['3:30.00', '2026-01-15'], ['3:25.00', '2026-02-01'], ['3:20.00', '2026-02-03'], ['3:12.27@', '2026-03-01']]

  it('names the first passing date from Feb 1, and the sparkline starts there', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m')
    serveSite(siteFiles([relayWith(dates, [12, 12, 16, 16])]))
    render(<App />)
    const line = await screen.findByText(/since Feb 3, when it was 3:20\.00\./)
    expect(line.closest('.detail-x').textContent).toMatch(/^The cutoff got 7\.73s faster since Feb 3/)
    expect(screen.queryByText(/Jan 15/)).toBeNull()
    expect(document.body.textContent).toContain('Saved daily lists hold the top 20 marks from mid-January to late May and the top 50 after that.')
    expect(screen.getByRole('link', { name: /^This season/ })).toBeTruthy()
  })

  it('hides the comparison when no list from Feb 1 is longer than the qualifying spot', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m')
    serveSite(siteFiles([relayWith(dates, [16, 12, 10, 12])]))
    render(<App />)
    await screen.findByText('12', { selector: 'tr.bubble .pl' })
    expect(document.body.textContent).not.toMatch(/ since |when it was|hasn’t moved/)
    expect(document.querySelector('[data-detail="season"] .spark')).toBeNull()
    expect(screen.getByRole('link', { name: /^This season/ })).toBeTruthy()
  })
})

describe('the board and the event page agree', () => {
  const saved = savedSite()

  async function boardCell(gender, label) {
    window.history.replaceState(null, '', `/?s=indoor&g=${gender}&view=board`)
    serveSite(saved)
    render(<App />)
    const link = await screen.findByRole('link', { name: label })
    const cell = link.closest('tr').querySelector('td.since')
    const text = cell.textContent
    const date = cell.dataset.since
    cleanup()
    return { text, date }
  }

  async function eventLine(gender, slug) {
    window.history.replaceState(null, '', `/?s=indoor&g=${gender}&event=${slug}`)
    serveSite(saved)
    render(<App />)
    const sentence = await screen.findByText(/since .+, when it was/)
    const text = sentence.closest('.detail-x').textContent
    cleanup()
    return text
  }

  it.each([
    ['m', 'Distance medley relay', 'distance-medley-relay'],
    ['m', 'Mile', 'mile'],
    ['f', 'Distance medley relay', 'distance-medley-relay'],
  ])('%s %s: same date, same starting line, same change', async (gender, label, slug) => {
    const board = await boardCell(gender, label)
    const page = await eventLine(gender, slug)
    const [, amount, way, when, line] = page.match(/^The cutoff got ([\d.]+)s (faster|slower) since (\w+ \d+), when it was ([\d:]+\.\d+)/)
    const [, sign, boardAmount, boardLine] = board.text.match(/^([−+])([\d.]+)s from ([\d:.]+)/)
    expect(boardAmount).toBe(amount)
    expect(boardLine).toBe(line)
    expect(sign).toBe(way === 'faster' ? '−' : '+')
    expect(when).toBe('Feb 1')
    expect(board.date).toBe('2026-02-01')
    expect(board.text).not.toMatch(/ since /)
  }, 20000)

  it('heads the board column "Since Feb 1"', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&view=board')
    serveSite(saved)
    render(<App />)
    expect(await screen.findByRole('columnheader', { name: 'Since Feb 1' })).toBeTruthy()
  })
})
