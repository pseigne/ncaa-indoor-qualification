import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import PastYears from '../src/components/PastYears'
import { formatMark, ordinal } from '../src/utils/format'
import { eventMeta } from '../src/utils/catalog'
import { pastLines, yearTick } from '../src/utils/past'

const saved = JSON.parse(readFileSync(resolve(process.cwd(), '../data/archive/past_cutoffs.json'), 'utf8'))
const mile = { season: 'indoor', region: 'National', gender: 'm', event: 'Mile' }

const MEN_MILE = {
  '2009-2010': '3:59.17',
  '2010-2011': '3:58.82',
  '2011-2012': '3:58.76',
  '2012-2013': '3:58.66',
  '2013-2014': '3:59.12',
  '2014-2015': '3:58.25',
  '2015-2016': '3:58.22',
  '2016-2017': '3:58.53',
  '2017-2018': '3:57.64',
  '2018-2019': '3:58.55',
  '2019-2020': '3:58.09',
  '2020-2021': '3:57.78',
  '2021-2022': '3:55.89',
  '2022-2023': '3:55.58',
  '2023-2024': '3:54.62',
  '2024-2025': '3:53.82',
  '2025-2026': '3:53.90',
}

function catalog(count) {
  return {
    lines: Array.from({ length: count }, (_, index) => ({
      season: 'indoor',
      region: 'National',
      gender: 'm',
      event: 'Mile',
      year: `${2000 + index}-${2001 + index}`,
      rank: 40 - index,
      mark: `4:${String(index).padStart(2, '0')}.00`,
      athlete: `Runner, ${index}`,
      team: `School ${index}`,
      tie: index === 0 ? { rank: 41, athlete: 'Strand, Ethan', team: 'North Carolina' } : null,
    })),
  }
}

function line(extra) {
  return {
    season: 'indoor',
    region: 'National',
    gender: 'm',
    event: 'Mile',
    rank: 16,
    of: 16,
    place: 16,
    athlete: 'Runner, Ada',
    team: 'School',
    rule: 'line',
    comparable: true,
    ...extra,
  }
}

function visibleRows(view) {
  return [...view.container.querySelectorAll('tbody tr')].filter(row => !row.hidden && !row.classList.contains('era'))
}

afterEach(cleanup)

describe('past lines for any number of seasons', () => {
  it.each([1, 3, 10])('keeps %i seasons, each with its own place', count => {
    const lines = pastLines(catalog(count), mile)
    expect(lines).toHaveLength(count)
    expect(new Set(lines.map(item => item.rank)).size).toBe(count)
    expect(lines.map(item => item.year)).toEqual([...lines].sort((a, b) => b.year.localeCompare(a.year)).map(item => item.year))
    const view = render(<PastYears lines={lines} kind="time" currentYear={lines[0].year} />)
    expect(visibleRows(view)).toHaveLength(Math.min(5, count))
    if (count > 5) fireEvent.click(view.getByRole('button', { name: `Show all ${count} seasons` }))
    const rows = visibleRows(view)
    expect(rows).toHaveLength(count)
    for (const item of lines) expect(view.container.textContent).toContain(ordinal(item.rank))
    expect(rows[0].textContent).toContain('This season')
    expect(rows[0].textContent).toContain(`${ordinal(lines[0].rank)} of ${lines[0].rank}`)
    expect(view.container.textContent).toContain('Strand, North Carolina, has the same mark and is listed 41st')
  })

  it('reads every saved indoor mile and keeps standards off the gap', () => {
    const lines = pastLines(saved, mile)
    expect(Object.fromEntries(lines.map(item => [item.year, item.mark]))).toEqual(MEN_MILE)
    const standards = lines.filter(item => item.year < '2012')
    expect(standards.map(item => item.year)).toEqual(['2011-2012', '2010-2011', '2009-2010'])
    expect(standards.every(item => item.comparable === false && item.rule === 'standards')).toBe(true)
    expect(lines.find(item => item.year === '2011-2012').place).toBe(15)
    expect(lines.find(item => item.year === '2009-2010')).toMatchObject({ flag: '@', conversion: 'altitude' })
    expect(lines.find(item => item.year === '2025-2026').conversion).toBeNull()
    const storedMile = saved.lines.find(item => item.gender === 'm' && item.event === 'Mile' && item.year === '2009-2010')
    expect(storedMile.conversion).toBe('altitude')
    const storedFlat = saved.lines.find(item => item.gender === 'm' && item.event === '200 Meters' && item.year === '2009-2010')
    expect(storedFlat).toMatchObject({ flag: '#', conversion: 'flat' })
    const storedOther = saved.lines.find(item => item.flag === '(1)')
    expect(storedOther.conversion).toBeNull()
    expect(lines.find(item => item.year === '2009-2010').converted).toContain('4:04.44')
    expect(lines.filter(item => item.year >= '2012').every(item => item.comparable)).toBe(true)
    expect(lines.find(item => item.year === '2019-2020').note).toBe('No meet (COVID)')
    expect(lines.find(item => item.year === '2023-2024').tie.rank).toBe(16)

    const sixty = pastLines(saved, { season: 'indoor', region: 'National', gender: 'm', event: '60 Meters' })
      .find(item => item.year === '2025-2026')
    expect(sixty.mark).toBe('6.57')
    expect(sixty.flag).toBe('@')
    expect(sixty.conversion).toBe('altitude')

    const view = render(<PastYears lines={lines} kind="time" currentYear="2025-2026" />)
    expect(visibleRows(view)).toHaveLength(5)
    expect(view.container.textContent).toContain('Among 14 seasonsSecond-fastest')
    expect(view.getByText('4.76s faster')).toBeTruthy()
    expect(view.container.textContent).toContain('Fastest, 2024–253:53.82')
    expect(view.getByText('Strand, North Carolina, has the same mark and is listed 16th')).toBeTruthy()
    expect(view.container.querySelector('circle.now')).toBeTruthy()
    expect(view.container.querySelector('circle.old')).toBeTruthy()
    expect(view.container.querySelector('.band')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Show all 17 seasons' }))
    expect(view.getAllByText('Not compared').length).toBeGreaterThan(0)
    expect(view.getAllByText(/16th listed/).length).toBeGreaterThan(0)
    expect(view.getAllByText('No meet (COVID)').length).toBeGreaterThan(0)
    const standardsRow = [...view.container.querySelectorAll('tr.old')].find(row => row.textContent.includes('2011–12'))
    expect(standardsRow.textContent).toContain('16th listed')
    expect(standardsRow.textContent).not.toContain('15th')
    expect(standardsRow.textContent).not.toContain('Tied from')
    for (const svg of view.container.querySelectorAll('.yc svg')) {
      const leader = svg.querySelector('.covid .leader')
      const label = svg.querySelector('.covid text')
      const lowest = Math.max(...[...svg.querySelectorAll('circle')].map(node => Number(node.getAttribute('cy'))))
      expect(Number(leader.getAttribute('y1'))).toBeGreaterThan(lowest)
      expect(Number(label.getAttribute('y'))).toBeGreaterThan(Number(leader.getAttribute('y2')))
    }
    expect([...view.container.querySelectorAll('svg.ph text.x')].map(node => node.textContent)).toEqual([
      yearTick('2010'), yearTick('2014'), yearTick('2018'), yearTick('2022'), yearTick('2026'),
    ])
    expect(view.container.querySelector('svg.ph text.era').textContent).toBe('Standards')
    expect(view.container.querySelector('svg.dk text.era').textContent).toBe('Standards era: no fixed cutoff')
    const phoneNow = [...view.container.querySelectorAll('svg.ph text.now')]
    const phoneDot = view.container.querySelector('svg.ph circle.now')
    expect(phoneNow.map(node => node.textContent).join(' ')).toMatch(/3:53\.90/)
    expect(phoneNow.every(node => node.getAttribute('text-anchor') === 'end')).toBe(true)
    const dotY = Number(phoneDot.getAttribute('cy'))
    expect(phoneNow.every(node => Number(node.getAttribute('y')) > dotY)).toBe(true)
    const altitudeRow = [...view.container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('2009'))
    expect(altitudeRow.textContent).toContain('Mark converted for altitude by TFRRS')
    expect(altitudeRow.textContent).toContain('Raw mark: 4:04.44')
    expect(altitudeRow.textContent).not.toContain('Converted from 4:04.44 for Altitude by TFRRS')
    expect(standardsRow.textContent).toContain('Not compared')
    expect(standardsRow.textContent).not.toMatch(/faster|slower/)
  })

  it('keeps a cancelled outdoor season out of the gap and uses the regional place', () => {
    const outdoor = pastLines(saved, { season: 'outdoor', region: 'East', gender: 'm', event: '1500 Meters' })
    expect(outdoor.length).toBeGreaterThan(10)
    expect(outdoor.find(item => item.year === '2026')).toMatchObject({ rank: 48, of: 48, comparable: true })
    expect(outdoor.find(item => item.year === '2021')).toMatchObject({ rank: 48, of: 48 })
    const cancelled = outdoor.find(item => item.year === '2020')
    expect(cancelled).toMatchObject({ rule: 'cancelled', comparable: false })
    const view = render(<PastYears lines={outdoor} kind="time" currentYear="2026" />)
    expect(view.container.textContent).toContain('48th of 48')
    fireEvent.click(view.getByRole('button', { name: /Show all/ }))
    const row = [...view.container.querySelectorAll('tbody tr')].find(item => item.textContent.includes('2020'))
    expect(row.textContent).toContain('Season cancelled')
    expect(row.textContent).toContain('Not compared')
    expect(row.textContent).not.toMatch(/faster|slower/)
  })

  it('gives field events the same history, with a higher mark as higher', () => {
    const jumps = pastLines(saved, { season: 'indoor', region: 'National', gender: 'm', event: 'High Jump' })
    expect(jumps.length).toBeGreaterThan(5)
    expect(jumps.every(item => item.mark.endsWith('m'))).toBe(true)
    const view = render(<PastYears lines={jumps} kind="mark" currentYear="2025-2026" />)
    expect(view.container.querySelector('.yc')).toBeTruthy()
    expect(view.container.textContent).toContain('top-16')
    expect(view.container.textContent).toContain('0.02\u00A0m lower')
    expect(view.container.textContent).not.toContain('worse')
    expect(view.container.textContent).not.toContain('faster')
    const tied = [...view.container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('2022–23'))
    expect(tied.textContent).toContain('16th of 16')
    expect(tied.textContent).toContain('Tied from 9th, 8 athletes at 2.21\u00A0m')
    expect(tied.textContent).not.toContain('9th of 16')
    const current = [...view.container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('2025–26'))
    expect(current.textContent).toContain('16th of 16')
    expect(current.textContent).toContain('Campbell, Tennessee, has the same mark and is listed 17th')
    expect(current.textContent).not.toContain('Tied from')
    for (const svg of view.container.querySelectorAll('.yc svg')) {
      const ticks = [...svg.querySelectorAll('text.tick')].map(node => node.textContent)
      expect(ticks.length).toBeGreaterThan(0)
      expect(ticks.length).toBeLessThanOrEqual(6)
      expect(ticks.every(label => /^\d+\.\d{2}\u00A0m$/.test(label))).toBe(true)
      expect(ticks).toContain('2.16\u00A0m')
      const leader = svg.querySelector('.covid .leader')
      const label = svg.querySelector('.covid text')
      const lowest = Math.max(...[...svg.querySelectorAll('circle')].map(node => Number(node.getAttribute('cy'))))
      expect(Number(leader.getAttribute('y1'))).toBeGreaterThan(lowest)
      expect(Number(label.getAttribute('y'))).toBeGreaterThan(Number(leader.getAttribute('y2')))
    }
  })

  it('keeps six or fewer y ticks on every event', () => {
    const series = new Map()
    for (const line of saved.lines) {
      const id = `${line.season}|${line.region}|${line.gender}|${line.event}`
      if (!series.has(id)) series.set(id, line)
    }
    const crowded = []
    for (const line of series.values()) {
      const lines = pastLines(saved, line)
      const kind = eventMeta(line.event).kind
      const view = render(<PastYears lines={lines} kind={kind} currentYear={lines[0]?.year || '2026'} />)
      for (const svg of view.container.querySelectorAll('.yc svg')) {
        const ticks = [...svg.querySelectorAll('text.tick')]
        if (ticks.length > 6) crowded.push(`${line.season} ${line.gender} ${line.event} ${ticks.length}`)
        const grid = [...svg.querySelectorAll('line.grid')].map(node => Number(node.getAttribute('y1')))
        if (grid.length) {
          const top = Math.min(...grid)
          const bottom = Math.max(...grid)
          for (const circle of svg.querySelectorAll('circle')) {
            const cy = Number(circle.getAttribute('cy'))
            if (cy < top - 0.6 || cy > bottom + 0.6) {
              crowded.push(`${line.season} ${line.gender} ${line.event} dot ${cy} outside ${top}–${bottom}`)
            }
          }
          const labelX = Number(ticks[0].getAttribute('x'))
          const first = [...svg.querySelectorAll('circle')].reduce((best, circle) => (
            Number(circle.getAttribute('cx')) < Number(best.getAttribute('cx')) ? circle : best
          ))
          const gap = Number(first.getAttribute('cx')) - Number(first.getAttribute('r')) - labelX
          if (gap < 11.5) crowded.push(`${line.event} gutter ${gap.toFixed(1)}`)
          const direction = svg.querySelector('text.k')
          const headroom = top - Number(direction.getAttribute('y'))
          if (headroom < 9.5) crowded.push(`${line.event} headroom ${headroom.toFixed(1)}`)
        }
        const era = svg.querySelector('text.era')
        const bandRect = svg.querySelector('rect.band')
        if (era && bandRect) {
          const font = svg.classList.contains('ph') ? 11 : 13
          const lineH = font + 3
          const chunks = [...era.querySelectorAll('tspan')]
          const left = Number(era.getAttribute('x'))
          const topInk = Number(era.getAttribute('y')) - font
          const bottomInk = Number(era.getAttribute('y')) + Math.max(0, chunks.length - 1) * lineH + 4
          let right = left
          for (const chunk of chunks) {
            const length = Number(chunk.getAttribute('textLength'))
            const width = length || chunk.textContent.length * font * 0.58
            right = Math.max(right, left + width)
          }
          const bandRight = Number(bandRect.getAttribute('x')) + Number(bandRect.getAttribute('width'))
          if (right > bandRight + 0.5) crowded.push(`${line.event} era past band`)
          for (const circle of svg.querySelectorAll('circle')) {
            const cx = Number(circle.getAttribute('cx'))
            const cy = Number(circle.getAttribute('cy'))
            const cr = Number(circle.getAttribute('r'))
            const nearestX = Math.max(left, Math.min(cx, right))
            const nearestY = Math.max(topInk, Math.min(cy, bottomInk))
            const dx = cx - nearestX
            const dy = cy - nearestY
            if (dx * dx + dy * dy < (cr + 2) ** 2) crowded.push(`${line.season} ${line.gender} ${line.event} era hits a dot`)
          }
        }
        if (kind === 'mark') {
          for (const tick of ticks) {
            if (!/^\d+\.\d{2}\u00A0m$/.test(tick.textContent)) crowded.push(`${line.event} ${tick.textContent}`)
          }
        }
        if (kind === 'points') {
          for (const tick of ticks) {
            if (!/^\d{1,3}(,\d{3})*\u00A0pts$/.test(tick.textContent)) crowded.push(`${line.event} ${tick.textContent}`)
          }
        }
      }
      cleanup()
    }
    expect(crowded).toEqual([])
    const relay = pastLines(saved, { season: 'indoor', region: 'National', gender: 'm', event: '4 x 400 Relay' })
    const relayView = render(<PastYears lines={relay} kind="time" currentYear="2025-2026" />)
    expect(relayView.container.textContent).toContain('12th of 12')
    const pent = pastLines(saved, { season: 'indoor', region: 'National', gender: 'f', event: 'Pentathlon' })
    const pentView = render(<PastYears lines={pent} kind="points" currentYear="2025-2026" />)
    const pentMark = formatMark(pent.find(item => item.year === '2025-2026').v, 'points')
    expect(pentView.container.textContent).toContain(pentMark)
    expect(pentView.container.querySelector('td.t').textContent).toBe(pentMark)
  }, 20000)

  it('drops a blank mark and renders nothing when an event has no lines', () => {
    const blank = pastLines({
      lines: [
        line({ event: 'High Jump', year: '2024-2025', mark: 'N/A' }),
        { season: 'outdoor', region: 'East', gender: 'm', event: '1500 Meters', year: '2025', rank: 48, mark: 'N/A', athlete: 'A', team: 'B' },
      ],
    }, { season: 'indoor', region: 'National', gender: 'm', event: 'High Jump' })
    expect(blank).toEqual([])
    const field = render(<PastYears lines={[]} kind="mark" currentYear="2025-2026" />)
    expect(field.container.querySelector('#past-years')).toBeNull()
  })
})
