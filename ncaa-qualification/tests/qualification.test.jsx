import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import { FOOTNOTE, markInfo } from '../src/utils/format'
import championships from '../src/config/championships.json'
import { buildEvents } from '../src/utils/model'
import { serveSite, siteFiles } from './site'

const fixturePath = resolve(process.cwd(), '../tests/qualification_fixtures.py')
const fixtures = JSON.parse(execFileSync('python3', [fixturePath], { encoding: 'utf8' }))

function serve(records, options) {
  serveSite(siteFiles(records, options))
}

// A saved day of a fixture's list, as the chart's series holds it.
function day(fixture, date) {
  return [date, fixture.mark, fixture.marks]
}

function open(search) {
  window.history.replaceState(null, '', `/${search}`)
}

function stripped(time) {
  return time.replace(/[@#]/g, '').trim()
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  open('')
})

describe('qualification on the heat sheet', () => {
  it.each(['relay', 'outdoor', 'individual', 'unsorted'])('uses the exact saved entry for %s', async name => {
    const { record } = fixtures[name]
    const { rank, is_relay: relay, entry } = record.qualification
    const season = record.season
    const region = record.region === 'National' ? 'East' : record.region
    open(`?s=${season}&g=${record.gender}&r=${region}&event=`)
    serve([record])
    render(<App />)
    const mark = stripped(entry.time)
    expect((await screen.findByLabelText(`Qualifying line ${mark}`, { exact: false })).textContent).toContain(mark.split(' ')[0])
    const bubble = document.querySelector('tr.bubble')
    expect(bubble.textContent).toContain(relay ? entry.team : entry.athlete)
    expect(bubble.textContent).toContain(mark)
    expect(bubble.querySelector('.pl').textContent).toBe(String(rank))
    const flagged = entry.time.includes('#') || entry.time.includes('@')
    if (flagged) expect(document.body.textContent).toContain(FOOTNOTE)
    else expect(document.body.textContent).not.toContain(FOOTNOTE)
    if (name === 'individual') {
      expect(document.body.textContent).toContain(`${mark}#`)
      expect(screen.getAllByRole('button', { name: 'converted for a flat or oversized track' }).length).toBeGreaterThan(0)
      expect(record.rankings.some(row => row.time.includes('#'))).toBe(true)
    } else {
      expect(document.body.textContent.replaceAll(FOOTNOTE, '')).not.toContain('#')
    }
  })

  it('uses saved relay classification rather than the event name', async () => {
    const record = { ...fixtures.relay.record, event: 'Saved event label' }
    open('?s=indoor&g=m')
    serve([record])
    render(<App />)
    const bubble = await screen.findByText('12', { selector: 'tr.bubble .pl' })
    expect(bubble.closest('tr').textContent).toContain('School 12')
    expect(screen.getByText(/top 12/)).toBeTruthy()
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.queryByRole('columnheader', { name: 'Team' })).toBeNull()
    expect(document.querySelector('figure.race')).toBeNull()
  })

  it.each(['short', 'missing'])('keeps the %s roster visible without inventing a cutoff', async name => {
    const { record } = fixtures[name]
    open('?s=indoor&g=m')
    serve([record])
    render(<App />)
    expect(await screen.findByText('Cutoff unavailable')).toBeTruthy()
    expect(document.querySelector('tr.bubble')).toBeNull()
    expect(document.querySelector('tr.line')).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(record.rankings.length + 1)
    if (name === 'short') {
      expect(document.body.textContent).not.toContain(FOOTNOTE)
      expect(document.body.textContent).not.toContain('#')
    } else {
      expect(document.body.textContent).toContain(FOOTNOTE)
      expect(screen.getAllByRole('button', { name: 'converted for altitude' }).length).toBeGreaterThan(0)
    }
  })

  it.each([
    undefined, null, {},
    { rank: 12, is_relay: true, status: 'available', entry: null },
    { rank: 12, is_relay: true, status: 'available', entry: { rank: 16, athlete: 'Wrong', time: '3:00.00' } },
    { rank: '12', is_relay: true, status: 'missing_rank', entry: null },
    { rank: 12, is_relay: true, status: 'missing_rank', entry: fixtures.relay.record.qualification.entry },
    { rank: 12, is_relay: true, status: 'available', entry: { rank: 12, athlete: 'Wrong', time: 123 } },
  ])('fails closed for malformed metadata %#', async qualification => {
    const record = { ...fixtures.relay.record, qualification }
    open('?s=indoor&g=m')
    serve([record])
    render(<App />)
    expect(await screen.findByText('Cutoff unavailable')).toBeTruthy()
    expect(document.querySelector('tr.bubble')).toBeNull()
    expect(document.querySelector('tr.line')).toBeNull()
  })
})

describe('conversion flags', () => {
  it.each([
    ['45.27#', 'flat', 45.27],
    ['6.57@', 'altitude', 6.57],
    ['1:47.64#@', 'both', 107.64],
    ['3:59.13 @#', 'both', 239.13],
    ['3:00.00', null, 180],
  ])('reads %s as %s', (raw, conversion, value) => {
    const mark = markInfo(raw)
    expect(mark.conversion).toBe(conversion)
    expect(mark.v).toBeCloseTo(value, 2)
  })

  it('reads a cleaned mark when the flag or stored conversion is separate', () => {
    expect(markInfo('3:59.17', { flag: '@' }).conversion).toBe('altitude')
    expect(markInfo('3:59.17', { flag: '@' }).v).toBeCloseTo(239.17, 2)
    expect(markInfo('7.83', { flag: '@(55)' })).toMatchObject({ conversion: 'altitude', v: 7.83 })
    expect(markInfo('6.66', { flag: '(55)' })).toMatchObject({ conversion: null, v: 6.66 })
    expect(markInfo('6.57', { conversion: 'altitude' })).toMatchObject({ conversion: 'altitude', alt: true, v: 6.57 })
    expect(markInfo('4183', { flag: '#' })).toMatchObject({ conversion: 'flat', v: 4183 })
  })
})

describe('pre-championship progression', () => {
  const indoor = championships.indoor['2025-2026']
  const outdoor = championships.outdoor['2026']

  it('keeps gaps and the same cutoff as the roster', async () => {
    const record = { ...fixtures.relay.record, series: [day(fixtures.relay, '2026-01-01'), day(fixtures.short, '2026-01-02'), day(fixtures.relay, '2026-01-03')] }
    open('?s=indoor&g=m')
    serve([record], { scope: { championship: indoor, listDate: '2026-01-03' } })
    render(<App />)
    expect((await screen.findByText('12', { selector: 'tr.bubble .pl' })).textContent).toBe('12')
    fireEvent.click(screen.getByRole('link', { name: /^This season/ }))
    const chart = await waitFor(() => {
      const svg = document.querySelector('.chart svg')
      expect(svg).toBeTruthy()
      return svg
    })
    expect(JSON.parse(chart.dataset.observations)).toEqual([['2026-01-01', 192.27], ['2026-01-02', null], ['2026-01-03', 192.27]])
    expect(chart.getAttribute('aria-label')).toContain('Rank 12')
    expect(chart.querySelector('.step').getAttribute('d').match(/M/g).length).toBeGreaterThan(1)
    expect(screen.getByRole('link', { name: 'NCAA indoor championships' })).toBeTruthy()
    expect(screen.queryByText(/already converted/)).toBeNull()
    expect(document.body.textContent).toContain(FOOTNOTE)
    expect(document.querySelector('time').dateTime).toBe('2026-03-13')
  })

  it('does not plot a saved day whose list has no qualifying mark', () => {
    const events = buildEvents({
      season: 'indoor',
      events: [{ ...fixtures.relay.record, series: [['2026-01-03', null, 16]], afterMeet: false }],
    })
    expect(events[0].line.v).toBeCloseTo(192.27, 2)
    expect(events[0].series).toEqual([{ d: '2026-01-03', v: null, n: 16 }])
    expect(events[0].tracked).toBe(false)
    expect(events[0].rows.find(row => row.rank === 12).note).toBe(false)
    expect(events[0].line.conversion).toBe('altitude')
    expect(events[0].rows.find(row => row.rank === 12).conversion).toBe('altitude')
    expect(events[0].rows.find(row => row.rank === 1).conversion).toBeNull()
  })

  it.each([
    ['relay', 'indoor', 'National', '2025-2026', '2026-03-12', indoor],
    ['outdoor', 'outdoor', 'East', '2026', '2026-05-26', outdoor],
    ['outdoor', 'outdoor', 'West', '2026', '2026-05-26', outdoor],
  ])('shows the saved days and the championship for %s / %s / %s', async (key, season, region, year, before, championship) => {
    const record = { ...fixtures[key].record, year, region, series: [day(fixtures[key], '2026-01-01'), day(fixtures.short, before)] }
    open(`?s=${season}&g=m&r=${region === 'West' ? 'East' : region}`)
    const east = { ...record, region: 'East' }
    serve(region === 'West' ? [east, record] : [record], { scope: { championship, listDate: before } })
    render(<App />)
    if (region === 'West') fireEvent.click(await screen.findByRole('link', { name: 'West' }))
    expect((await screen.findByText(String(record.qualification.rank), { selector: 'tr.bubble .pl' })).textContent).toBe(String(record.qualification.rank))
    fireEvent.click(screen.getByRole('link', { name: /^This season/ }))
    const chart = await waitFor(() => {
      const svg = document.querySelector('.chart svg')
      expect(svg).toBeTruthy()
      return svg
    })
    expect(JSON.parse(chart.dataset.observations)).toEqual([['2026-01-01', 192.27], [before, null]])
    expect(screen.getByRole('link', { name: /championships|First Rounds/ })).toBeTruthy()
    expect(document.querySelector('time').dateTime).toBe(championship.start_date)
  })

  it('says when every saved snapshot is after the championship', async () => {
    open('?s=outdoor&g=m&r=East')
    serve([{ ...fixtures.outdoor.record, afterMeet: true }], { scope: { championship: outdoor, final: false } })
    render(<App />)
    expect(await screen.findByText('No saved lists before the First Round, so there’s no season to show.')).toBeTruthy()
    expect(document.querySelector('time').dateTime).toBe('2026-05-27')
    expect(document.querySelector('.chart svg')).toBeNull()
  })
})
