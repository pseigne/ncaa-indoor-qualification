import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '../src/App'
import PastYears from '../src/components/PastYears'
import { buildEvents } from '../src/utils/model'
import { pastLines } from '../src/utils/past'
import { readField } from '../src/utils/qualification'
import { STRIP_DEPTH, fieldMeters, stripDepth, topWords } from '../src/utils/strip'
import { serveSite, siteFiles } from './site'

// A men's indoor mile with the line at 16: 3:53.00, 3:53.25, ... a quarter second apart.
function mile(count = 30, rank = 16, field = undefined) {
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
    ...(field !== undefined ? { field } : {}),
  }
}

// The field as accepted on Mar 3: down to 19th, with 17th and 19th in and 6th and 12th not.
function accepted(extra = {}) {
  return {
    status: 'available',
    rank: 19,
    size: 16,
    accepted: '2026-03-03',
    cancelled: false,
    entry: { rank: 19, athlete: 'Runner 19', team: 'School 19', time: '3:57.50' },
    in: [17, 19],
    out: [6, 12],
    unmatched: 0,
    ...extra,
  }
}

// A past season's field: the same, without the ranks it took in or left out.
function pastField(field) {
  const past = { ...field }
  delete past.in
  delete past.out
  return past
}

// The same field held at the line: the top 16 all accepted.
function held(extra = {}) {
  return accepted({ rank: 16, entry: { rank: 16, athlete: 'Runner 16', team: 'School 16', time: '3:56.75' }, in: [], out: [], ...extra })
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

async function open(records, { width = 1440, url = '/?s=indoor&g=m&event=mile', line = 16 } = {}) {
  screenAt(width)
  window.history.replaceState(null, '', url)
  serveSite(siteFiles(records))
  render(<App />)
  await screen.findByText(String(line), { selector: 'tr.bubble .pl' })
}

const row = rank => document.querySelector(`tbody tr[data-rank="${rank}"]`)
const tags = () => Object.fromEntries([...document.querySelectorAll('tbody tr[data-rank] .tag')].map(tag => [tag.closest('tr').dataset.rank, tag.textContent]))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('reading the saved field', () => {
  it('keeps a field that follows the contract', () => {
    expect(readField({ field: accepted() })).toEqual(accepted())
    expect(readField({ field: accepted({ status: 'unmatched', rank: null, entry: null, unmatched: 2 }) })?.status).toBe('unmatched')
    expect(readField({ field: accepted({ status: 'beyond_list', rank: null, entry: null }) })?.status).toBe('beyond_list')
    const past = pastField(accepted())
    expect(readField({ field: past }, { history: true })).toEqual(past)
  })

  it.each([
    undefined, null, 'field', {},
    accepted({ status: 'missing' }),
    accepted({ accepted: '2026-03-03T16:18' }),
    accepted({ accepted: undefined }),
    accepted({ cancelled: undefined }),
    accepted({ size: 0 }),
    accepted({ rank: '19' }),
    accepted({ unmatched: 1 }),
    accepted({ entry: null }),
    accepted({ entry: { rank: 18, athlete: 'Runner 19', team: 'School 19', time: '3:57.50' } }),
    accepted({ entry: { rank: 19, athlete: '', team: 'School 19', time: '3:57.50' } }),
    accepted({ entry: { rank: 19, athlete: 'Runner 19', team: 'School 19', time: 237.5 } }),
    accepted({ in: [17, '19'] }),
    accepted({ out: null }),
    accepted({ status: 'unmatched', unmatched: 0 }),
  ])('reads a malformed field as none %#', field => {
    expect(readField({ field })).toBeNull()
  })

  it('needs in and out on a list, never on a past season', () => {
    const past = pastField(accepted())
    expect(readField({ field: past })).toBeNull()
    expect(readField({ field: past }, { history: true })).not.toBeNull()
    expect(readField({ field: { ...past, in: 'all' } }, { history: true })).toBeNull()
  })

  it('gives the event its field row as a mark, and the ranks it took in or left out', () => {
    const [event] = buildEvents({ season: 'indoor', events: [mile(30, 16, accepted())] })
    expect(event.field).toMatchObject({ status: 'available', rank: 19, size: 16, accepted: '2026-03-03', cancelled: false })
    expect(event.field.entry).toMatchObject({ rank: 19, athlete: 'Runner 19', team: 'School 19', conversion: null })
    expect(event.field.entry.v).toBeCloseTo(237.5, 2)
    expect([...event.field.in]).toEqual([17, 19])
    expect([...event.field.out]).toEqual([6, 12])
    expect(buildEvents({ season: 'indoor', events: [mile()] })[0].field).toBeNull()
    const unread = accepted({ entry: { rank: 19, athlete: 'Runner 19', team: 'School 19', time: 'DNF' } })
    expect(buildEvents({ season: 'indoor', events: [mile(30, 16, unread)] })[0].field).toBeNull()
  })
})

describe('the field line on the heat sheet', () => {
  it('draws a second line after the deepest place the field took, and keeps the qualifying line as it was', async () => {
    await open([mile(30, 16, accepted())])
    const finish = document.getElementById('finish')
    expect(finish.textContent).toBe('Qualifying line · top 16 go to nationals First one out is 0.25s back')
    expect(finish.closest('tr').previousElementSibling).toBe(row(16))
    const fieldRow = document.querySelector('tr.fieldrow')
    expect(fieldRow.previousElementSibling).toBe(row(19))
    expect(fieldRow.nextElementSibling).toBe(row(20))
    expect(fieldRow.textContent).toBe('Field line · reached 19th as accepted Mar 3')
    expect(fieldRow.querySelector('td').colSpan).toBe(5)
    expect(fieldRow.querySelector('button, [tabindex]')).toBeNull()
    expect(document.querySelectorAll('tr.fieldrow')).toHaveLength(1)
  })

  it('tags who got in from below the line and who inside it scratched', async () => {
    await open([mile(30, 16, accepted())])
    expect(tags()).toEqual({ 6: 'Scratched', 12: 'Scratched', 17: 'In', 19: 'In' })
    expect(row(17).querySelector('.tag').className).toBe('tag tag-in')
    expect(row(6).querySelector('.tag').className).toBe('tag tag-out')
    expect(row(17).getAttribute('aria-label')).toBe('17. Runner 17, School 17, 3:57.00, out, 0.25s behind the line, in the field')
    expect(row(18).getAttribute('aria-label')).toBe('18. Runner 18, School 18, 3:57.25, out, 0.50s behind the line')
    expect(row(6).getAttribute('aria-label')).toBe('6. Runner 6, School 6, 3:54.25, in, 2.50s ahead of the line, scratched, not in the field')
  })

  it('says how deep the field reached in the hero', async () => {
    await open([mile(30, 16, accepted())])
    const lead = document.querySelector('.herocard .lead')
    expect(lead.querySelector('.field-lead').textContent).toBe('The field reached 19th: Runner 19, School 19 (3:57.50).')
    expect(lead.textContent).toBe('16th on the list: Runner 16, School 16. The field reached 19th: Runner 19, School 19 (3:57.50).')
  })

  it('shows rows down to six past the deeper line', async () => {
    await open([mile(30, 16, accepted())])
    expect(Number([...document.querySelectorAll('tbody tr[data-rank]')].at(-1).dataset.rank)).toBe(25)
    expect(screen.getByRole('button', { name: 'Show all 30' })).toBeTruthy()
    cleanup()
    await open([mile(40, 16, accepted({ rank: 28, entry: { rank: 28, athlete: 'Runner 28', team: 'School 28', time: '3:59.75' }, in: [17, 28] }))])
    expect(Number([...document.querySelectorAll('tbody tr[data-rank]')].at(-1).dataset.rank)).toBe(34)
  })

  it('says the field held at the line when it reached no deeper', async () => {
    await open([mile(30, 16, held())])
    const fieldRow = document.querySelector('tr.fieldrow')
    expect(fieldRow.previousElementSibling).toBe(document.getElementById('finish').closest('tr'))
    expect(fieldRow.textContent).toBe('Field line · held at the line as accepted Mar 3')
    expect(document.querySelector('.field-lead').textContent).toBe('The field held at the line.')
    expect(tags()).toEqual({})
  })

  it('leaves out the date when the accepted list had none', async () => {
    expect(readField({ field: accepted({ accepted: null }) })?.accepted).toBeNull()
    await open([mile(30, 16, accepted({ accepted: null }))])
    expect(document.querySelector('tr.fieldrow').textContent).toBe('Field line · reached 19th')
    expect(document.querySelector('tr.fieldrow .why')).toBeNull()
    cleanup()
    await open([mile(30, 16, accepted({ accepted: null, cancelled: true }))])
    expect(document.querySelector('tr.fieldrow').textContent).toBe('Field line · reached 19th · meet cancelled')
  })

  it('says the meet was cancelled', async () => {
    await open([mile(30, 16, accepted({ cancelled: true }))])
    expect(document.querySelector('tr.fieldrow').textContent).toBe('Field line · reached 19th as accepted Mar 3 · meet cancelled')
    expect(document.querySelector('.field-lead').textContent).toBe('The field reached 19th: Runner 19, School 19 (3:57.50). The meet was cancelled.')
  })

  it.each([
    [accepted({ status: 'unmatched', rank: null, entry: null, unmatched: 2 }), 'No field line: 2 accepted entries aren’t matched to this list.'],
    [accepted({ status: 'unmatched', unmatched: 1 }), 'No field line: 1 accepted entry isn’t matched to this list.'],
    [accepted({ status: 'beyond_list', rank: null, entry: null }), 'The field reached past the 30 places on this list.'],
  ])('leaves a note instead of a line %#', async (field, note) => {
    await open([mile(30, 16, field)])
    expect(document.querySelector('.field-lead').textContent).toBe(note)
    expect(document.querySelector('tr.fieldrow')).toBeNull()
    expect(tags()).toEqual({})
    expect(Number([...document.querySelectorAll('tbody tr[data-rank]')].at(-1).dataset.rank)).toBe(22)
  })

  it.each([undefined, null, accepted({ accepted: 'Mar 3' })])('changes nothing without a field %#', async field => {
    await open([mile(30, 16, field)])
    expect(document.querySelector('tr.fieldrow')).toBeNull()
    expect(document.querySelector('.field-lead')).toBeNull()
    expect(document.querySelector('.tag')).toBeNull()
    expect(document.querySelector('.herocard .lead').textContent).toBe('16th on the list: Runner 16, School 16.')
    expect(Number([...document.querySelectorAll('tbody tr[data-rank]')].at(-1).dataset.rank)).toBe(22)
    expect(row(17).getAttribute('aria-label')).toBe('17. Runner 17, School 17, 3:57.00, out, 0.25s behind the line')
  })

  it('tags a relay squad whose school is already in the field, and reads a malformed list as no field', async () => {
    await open([mile(30, 16, accepted({ qualified: [18] }))])
    expect(tags()).toMatchObject({ 6: 'Scratched', 12: 'Scratched', 17: 'In', 18: 'Already Qualified', 19: 'In' })
    expect(row(18).querySelector('.tag').className).toBe('tag tag-qualified')
    expect(row(18).getAttribute('aria-label')).toMatch(/, already qualified, its school’s team is in the field$/)
    expect(readField({ field: accepted({ qualified: [0] }) })).toBeNull()
    expect(readField({ field: accepted() })).not.toBeNull()
  })

  it('keeps the field line and tags on phones', async () => {
    await open([mile(30, 16, accepted())], { width: 390 })
    expect(document.querySelector('tr.fieldrow').previousElementSibling).toBe(row(19))
    expect(tags()).toMatchObject({ 17: 'In', 19: 'In' })
    expect(document.querySelector('.field-lead').textContent).toBe('The field reached 19th: Runner 19, School 19 (3:57.50).')
  })
})

describe('the board', () => {
  function eight(field) {
    const record = mile()
    const rankings = record.rankings.map(item => ({ ...item, time: `1:${(46 + (item.rank - 1) * 0.1).toFixed(2)}` }))
    return { ...record, event: '800 Meters', rankings, qualification: { ...record.qualification, entry: { ...rankings[15] } }, ...(field ? { field } : {}) }
  }

  async function board(records) {
    screenAt(1440)
    window.history.replaceState(null, '', '/?s=indoor&g=m&view=board')
    serveSite(siteFiles(records))
    render(<App />)
    return screen.findByRole('table', { name: 'Every qualifying line' })
  }

  const cell = (table, label) => [...table.querySelectorAll('tbody tr')].find(item => item.querySelector('td.ev')?.textContent === label)?.querySelector('td.field')

  it('adds a Field reached column once any event has a field', async () => {
    const table = await board([mile(30, 16, accepted()), eight()])
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['Event', 'Line', 'Held by', 'Team', 'Field reached', 'Since Feb 1', 'Season, faster ↑'])
    expect(cell(table, 'Mile').textContent).toBe('Field reached 19th · 3:57.50')
    expect(cell(table, 'Mile').querySelector('.ph').textContent).toBe('Field reached ')
    expect(cell(table, '800m').textContent).toBe('')
    expect([...table.querySelectorAll('tr.grp td')].every(td => td.colSpan === 7)).toBe(true)
  })

  it('says why an event has no field line', async () => {
    const table = await board([
      mile(30, 16, accepted({ status: 'unmatched', rank: null, entry: null, unmatched: 2 })),
      eight(accepted({ status: 'beyond_list', rank: null, entry: null })),
    ])
    expect(cell(table, 'Mile').textContent).toBe('Field reached not matched')
    expect(cell(table, '800m').textContent).toBe('Field reached past the list')
  })

  it('has no column without a field', async () => {
    const table = await board([mile(), eight()])
    expect([...table.querySelectorAll('thead th')].map(th => th.textContent)).not.toContain('Field reached')
    expect(table.querySelector('td.field')).toBeNull()
    expect([...table.querySelectorAll('tr.grp td')].every(td => td.colSpan === 6)).toBe(true)
  })
})

describe('past years', () => {
  const scope = { season: 'indoor', region: 'National', gender: 'f', event: 'Long Jump' }

  function line(year, mark, field) {
    return {
      season: 'indoor', region: 'National', gender: 'f', event: 'Long Jump', year, rank: 16, of: 16, place: 16, mark,
      athlete: 'Jumper, Ada', team: 'School', rule: 'line', comparable: true,
      ...(field ? { field: pastField(field) } : {}),
    }
  }

  function jump(rank, time) {
    return { rank, athlete: 'Jumper, Bea', team: 'Other School', time }
  }

  it('puts each season’s field next to its qualifying line', () => {
    const lines = pastLines({
      lines: [
        line('2025-2026', '6.71', accepted({ entry: jump(19, '6.68') })),
        line('2024-2025', '6.66', held({ entry: jump(16, '6.66') })),
        line('2019-2020', '6.50', accepted({ rank: 18, entry: jump(18, '6.47'), cancelled: true })),
        line('2018-2019', '6.48', accepted({ accepted: 'Mar 3' })),
        line('2017-2018', '6.45', accepted({ status: 'unmatched', rank: null, entry: null, unmatched: 3 })),
        line('2016-2017', '6.44'),
      ],
    }, scope)
    expect(lines.map(item => item.field?.status ?? null)).toEqual(['available', 'available', 'available', null, 'unmatched', null])
    const view = render(<PastYears lines={lines} kind="mark" currentYear="2025-2026" />)
    fireAll(view)
    const note = year => [...view.container.querySelectorAll('tbody tr')].find(item => item.textContent.includes(year))?.querySelector('.fld')?.textContent ?? null
    expect(note('2025–26')).toBe('Field reached 19th · 6.68 m')
    expect(note('2024–25')).toBe('Field held at the line · 6.66 m')
    expect(note('2019–20')).toBe('Field reached 18th · 6.47 m · meet cancelled')
    expect(note('2018–19')).toBeNull()
    expect(note('2017–18')).toBe('Field not matched to the list')
    expect(note('2016–17')).toBeNull()
  })

  // Every season, not just the recent five.
  function fireAll(view) {
    const more = [...view.container.querySelectorAll('button.more')].find(button => /^Show all/.test(button.textContent))
    more?.click()
  }
})

describe('the race strip on a 100-deep list', () => {
  function deep(count = 100, field = undefined) {
    const rankings = Array.from({ length: count }, (_, index) => ({
      rank: index + 1, athlete: `Runner, ${index + 1}`, team: `School ${index + 1}`, time: `3:${(40 + index * 0.1).toFixed(2)}`,
    }))
    return {
      year: '2026', event: '1500 Meters', season: 'outdoor', region: 'East', gender: 'm', rankings,
      qualification: { rank: 48, is_relay: false, status: 'available', entry: { ...rankings[47] } },
      ...(field ? { field } : {}),
    }
  }
  const url = '/?s=outdoor&g=m&r=East&event=1500m'

  it('runs 60 places, or 12 past the deeper line', () => {
    expect(STRIP_DEPTH).toBe(60)
    expect(stripDepth(16)).toBe(60)
    expect(stripDepth(48)).toBe(60)
    expect(stripDepth(48, 55)).toBe(67)
    expect(stripDepth(24, 19)).toBe(60)
    expect(stripDepth(null, null)).toBe(60)
    const placed = [{ rank: 1, m: 4 }, { rank: 2, m: 2 }, { rank: 3, m: -1 }]
    expect(fieldMeters(placed, 2)).toBe(0.5)
    expect(fieldMeters(placed, 3)).toBe(-1.5)
    expect(fieldMeters(placed, 9)).toBeNull()
    expect(topWords(60, 100)).toBe('60 of 100')
    expect(topWords(30, 30)).toBe('30')
  })

  it('stops the standing strip at 60 and says so, while the table keeps all 100', async () => {
    await open([deep()], { url, line: 48 })
    await vi.waitFor(() => expect(document.querySelector('.rail .dot')).toBeTruthy())
    expect(document.querySelectorAll('.rail .dot')).toHaveLength(60)
    expect(Math.max(...[...document.querySelectorAll('.rail .dot')].map(dot => Number(dot.dataset.rank)))).toBe(60)
    expect(document.querySelector('.rail figcaption').textContent).toMatch(/^The top 60 of 100 as one race, as 3:44\.70 crosses the line\./)
    expect(document.querySelector('.rail svg').getAttribute('aria-label')).toMatch(/^The top 60 of 100 placed as one race/)
    expect(screen.getByRole('button', { name: 'Show all 100' })).toBeTruthy()
  })

  it('runs 12 past a field line deeper than 48', async () => {
    const field = accepted({ rank: 55, size: 48, accepted: '2026-05-21', entry: { rank: 55, athlete: 'Runner, 55', team: 'School 55', time: '3:45.40' }, in: [50, 55], out: [3, 9] })
    await open([deep(100, field)], { url, line: 48 })
    await vi.waitFor(() => expect(document.querySelector('.rail .dot')).toBeTruthy())
    expect(document.querySelectorAll('.rail .dot')).toHaveLength(67)
    expect(document.querySelector('.rail figcaption').textContent).toMatch(/^The top 67 of 100 as one race/)
    expect(Number([...document.querySelectorAll('tbody tr[data-rank]')].at(-1).dataset.rank)).toBe(61)
    expect(document.querySelector('tr.fieldrow').textContent).toBe('Field line · reached 55th as accepted May 21')
    // The race draws the field line too, between the deepest place the field took and the next one.
    const rule = document.querySelector('.rail .fld-l line:not(.under)')
    const y = rank => Number(document.querySelector(`.rail .dot[data-rank="${rank}"]`).style.transform.match(/, ([-\d.]+)px/)[1])
    expect(Number(rule.getAttribute('y1'))).toBeLessThanOrEqual(Math.max(y(55), y(56)))
    expect(Number(rule.getAttribute('y1'))).toBeGreaterThanOrEqual(Math.min(y(55), y(56)))
    expect(document.querySelector('.rail .fld-tag').textContent).toBe('Field line')
  })

  it('draws the field line across the flat strip on phones', async () => {
    const field = accepted({ rank: 55, size: 48, accepted: '2026-05-21', entry: { rank: 55, athlete: 'Runner, 55', team: 'School 55', time: '3:45.40' }, in: [50, 55], out: [3, 9] })
    await open([deep(100, field)], { url, line: 48, width: 390 })
    const x = Number(document.querySelector('.race.card .fld-l line:not(.under)').getAttribute('x1'))
    const lineX = Number(document.querySelector('.race.card .fl line').getAttribute('x1'))
    expect(x).toBeLessThan(lineX)
    expect(document.querySelector('.race.card .fld-tag').textContent).toBe('Field line')
  })

  it('draws no second line in the race when the field held at the line', async () => {
    await open([deep(100, accepted({ rank: 48, size: 48, entry: { rank: 48, athlete: 'Runner, 48', team: 'School 48', time: '3:44.70' }, in: [], out: [] }))], { url, line: 48, width: 390 })
    expect(document.querySelector('.race.card .fl line')).toBeTruthy()
    expect(document.querySelector('.race.card .fld-l')).toBeNull()
  })

  it('stops the flat strip at 60 on phones and says so in its caption', async () => {
    await open([deep()], { url, line: 48, width: 390 })
    expect(document.querySelectorAll('.race.card .dot')).toHaveLength(60)
    expect(document.querySelector('.strip-cap').textContent).toBe('Top 60 of 100 as one race. Meters are estimates.')
    expect(document.querySelector('.race.card svg').getAttribute('aria-label')).toMatch(/^The top 60 of 100 placed as one race/)
  })

  it('keeps every row of a list no deeper than 60', async () => {
    await open([deep(54)], { url, line: 48, width: 390 })
    expect(document.querySelectorAll('.race.card .dot')).toHaveLength(54)
    expect(document.querySelector('.strip-cap').textContent).toBe('Top 54 as one race. Meters are estimates.')
    expect(document.querySelector('.race.card svg').getAttribute('aria-label')).toMatch(/^The top 54 placed as one race/)
  })
})
