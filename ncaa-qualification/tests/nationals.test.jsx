import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../src/App'
import NationalsCard from '../src/components/NationalsCard'
import {
  nationalsEntries, nationalsEvents, orderQualifiers, readNationals, regionSummary, summaryParts, wentOn,
} from '../src/utils/nationals'
import { href, readQuery } from '../src/utils/route'
import { nationalsFile, nationalsSite } from './nationals'
import { fetched, serveSite } from './site'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

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
}

async function openMeet(url = '/?g=f&s=outdoor&r=East&y=2026&event=100m&view=nationals', { width = 1440, site = nationalsSite(), fail } = {}) {
  screenAt(width)
  window.history.replaceState(null, '', url)
  serveSite(site, { fail })
  render(<App />)
}

const rows = () => [...document.querySelectorAll('table.nat tbody tr:not(.nat-grp)')]
const names = () => rows().map(row => row.querySelector('td.ath').textContent)
const filters = () => screen.getByRole('navigation', { name: 'Season and gender' })

describe('the nationals route', () => {
  it('reads and writes view=nationals for outdoor, keyed by gender, year and event', () => {
    const search = '?g=f&s=outdoor&r=East&y=2026&event=100m&view=nationals'
    const query = readQuery(search)
    expect(query).toMatchObject({ view: 'nationals', gender: 'f', season: 'outdoor', year: '2026', event: '100m' })
    expect(href(query)).toBe(search)
    expect(href(readQuery('?g=m&s=outdoor&view=nationals'))).toBe('?g=m&s=outdoor&r=East&view=nationals')
  })

  it('falls back to the event page indoors, and never writes view=nationals there', () => {
    expect(readQuery('?g=f&s=indoor&view=nationals').view).toBe('event')
    expect(readQuery('?g=f&view=nationals').view).toBe('event')
    expect(href({ view: 'nationals', gender: 'f', season: 'indoor', event: 'mile' })).toBe('?g=f&s=indoor&event=mile')
  })

  it('keeps every other view as it was', () => {
    for (const search of ['?g=m&s=indoor&event=mile', '?g=f&s=outdoor&r=West&y=2025&view=board', '?g=m&s=indoor&event=mile&d=2026-02-01']) {
      expect(href(readQuery(search))).toBe(search)
    }
    expect(readQuery('?view=season')).toMatchObject({ view: 'event', detail: 'season', legacy: true })
    expect(readQuery('?view=elsewhere').view).toBe('event')
  })
})

describe('reading the nationals file', () => {
  it('refuses a file that is not a national meet, without throwing', () => {
    for (const bad of [null, [], 'text', {}, { ...nationalsFile(), season: 'indoor' }, { ...nationalsFile(), year: 26 },
      { ...nationalsFile(), gender: 'x' }, { ...nationalsFile(), events: {} }]) {
      expect(readNationals(bad)).toBeNull()
    }
  })

  it('drops events and qualifiers that are not what the contract says, and keeps only web links', () => {
    const data = readNationals({
      ...nationalsFile(),
      events: [
        { event: '100 Meters', qualifiers: [null, { team: 'No name' }, { athlete: 'Kept, Ann', region: 'North', nationals: { place: 3, round: 'semifinal', status: 'LATE' } }] },
        { event: '', qualifiers: [] },
        { qualifiers: [] },
      ],
    })
    expect(data.events).toHaveLength(1)
    expect(data.events[0].qualifiers).toEqual([{
      athlete: 'Kept, Ann', team: '', region: null, listRank: null, seed: null, firstRound: null,
      nationals: { place: null, round: 'semifinal', mark: null, wind: null, status: null, points: null },
    }])
    expect(data.sources.map(source => source.label)).toEqual(['RecordTiming qualifier list', 'Flash Results'])
  })

  it('lists the meets for one gender from index.json, newest first, and none without the key', () => {
    const index = nationalsSite()['index.json']
    expect(nationalsEntries(index, 'f')).toEqual([
      { year: '2026', file: 'nationals-outdoor-2026-f.json' },
      { year: '2019', file: 'nationals-outdoor-2019-f.json' },
    ])
    expect(nationalsEntries(index, 'm')).toEqual([])
    expect(nationalsEntries({ lists: [] }, 'f')).toEqual([])
    expect(nationalsEntries({ lists: [], nationals: [{ season: 'outdoor', year: '2026', gender: 'f', file: '../index.json' }] }, 'f')).toEqual([])
  })

  it('orders finalists by place, then those out by round and seed, then no results', () => {
    const [hundred] = nationalsEvents(readNationals(nationalsFile()))
    const order = hundred.qualifiers.map(q => q.athlete)
    expect(order.slice(0, 9)).toEqual(Array.from({ length: 9 }, (_, at) => `Runner${at + 1}, Ann`))
    expect(order.slice(9, 22)).toEqual(Array.from({ length: 13 }, (_, at) => `Runner${at + 10}, Ann`))
    expect(order.slice(22)).toEqual(['Runner23, Ann', 'Runner24, Ann'])
  })

  it('puts field marks in seed order with the higher mark first before results', () => {
    const order = orderQualifiers([
      { athlete: 'B', seed: '6.50', nationals: null },
      { athlete: 'A', seed: '6.90', nationals: null },
      { athlete: 'C', seed: null, nationals: null },
    ], 'mark')
    expect(order.map(q => q.athlete)).toEqual(['A', 'B', 'C'])
  })

  it('counts East against West in the final, the top 8 and the points', () => {
    const [hundred] = nationalsEvents(readNationals(nationalsFile()))
    const summary = regionSummary(hundred.qualifiers)
    expect(summaryParts(summary)).toEqual([
      { label: 'Qualifiers', words: '12 East, 12 West' },
      { label: 'Final', words: '5 East, 4 West' },
      { label: 'Top 8', words: '5 East, 3 West' },
      { label: 'Points', words: '22 East, 17 West' },
    ])
  })
})

describe('the nationals page', () => {
  it('shows the 24 qualifiers as a heat sheet in final order', async () => {
    await openMeet()
    expect(await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, nationals' })).toBeTruthy()
    expect(document.title).toBe('Women’s 100m, nationals, 2026 · NCAA Track and Field National Qualification Tracker')
    expect(rows()).toHaveLength(24)
    expect(names().slice(0, 3)).toEqual(['Ann Runner1', 'Ann Runner2', 'Ann Runner3'])
    const first = rows()[0]
    expect(first.querySelector('td.pl').textContent).toBe('1')
    expect(first.querySelector('td.team').textContent).toBe('School 1')
    expect(first.querySelector('td.t').textContent).toBe('10.80')
    expect(first.querySelector('td.wind').textContent).toBe('wind −0.4')
    expect(first.querySelector('td.fr').textContent).toBe('First Round 1st 11.11Q')
    expect(first.querySelector('.nat-q').getAttribute('title')).toBe('Advanced on place')
    expect(rows()[2].querySelector('.nat-q.time').textContent).toBe('q')
  })

  it('tags each qualifier with their First Round, East or West', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    const chips = rows().slice(0, 3).map(row => row.querySelector('.nat-reg'))
    expect(chips.map(chip => chip.className)).toEqual(['nat-reg west', 'nat-reg east', 'nat-reg east'])
    expect(chips.map(chip => chip.textContent)).toEqual(['WWest', 'EEast', 'EEast'])
    expect(chips[0].querySelector('[aria-hidden="true"]').textContent).toBe('W')
    expect(chips[0].querySelector('.vh').textContent).toBe('West')
  })

  it('names the round for those out before the final and puts no results at the bottom', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    const headings = [...document.querySelectorAll('tr.nat-grp th')].map(cell => cell.textContent)
    expect(headings).toEqual(['Final', 'Out in the semifinals', 'Did not start, finish or mark'])
    const semi = rows()[9]
    expect(semi.className).toBe('out')
    expect(semi.querySelector('td.pl abbr').textContent).toBe('SF')
    expect(semi.querySelector('td.pl abbr').getAttribute('title')).toBe('Semifinal')
    expect(semi.querySelector('td.t').textContent).toBe('11.30')
    const [dnf, dns] = rows().slice(22)
    expect(dnf.querySelector('td.t').textContent).toBe('DNF')
    expect(dnf.querySelector('td.t abbr').getAttribute('title')).toBe('Did not finish')
    expect(dns.querySelector('td.t').textContent).toBe('DNS')
    expect(dns.querySelector('td.wind').textContent).toBe('')
  })

  it('sums up East against West above the sheet, and explains how the field was made', async () => {
    await openMeet()
    const strip = await screen.findByRole('list', { name: 'East and West' })
    expect(within(strip).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Qualifiers 12 East, 12 West', 'Final 5 East, 4 West', 'Top 8 5 East, 3 West', 'Points 22 East, 17 West',
    ])
    expect(screen.getByText(/The top 12 athletes in each event at each First Round, East and West, go on to nationals, 24 in all\. A place left by a scratch at nationals is not filled\./)).toBeTruthy()
    expect(document.querySelector('.nat-meet').textContent).toBe('NCAA Division I Outdoor Track & Field Championships, from June 10, 2026')
  })

  it('links the meet’s sources and nothing that is not a web link', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    const source = document.querySelector('.source')
    expect(source.textContent).toBe('Source: RecordTiming qualifier list · Flash Results.')
    expect([...source.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual([
      'https://www.rtspt.com/ncaa/d1outdoor26/women_qualifiers.htm',
      'https://www.flashresults.com/2026_Meets/Outdoor/06-10_NCAA/index.htm',
    ])
  })

  it('shows the multis from the national list, with no First Round column', async () => {
    await openMeet('/?g=f&s=outdoor&r=East&y=2026&event=heptathlon&view=nationals')
    await screen.findByRole('heading', { level: 1, name: 'Women’s heptathlon, nationals' })
    expect([...document.querySelectorAll('table.nat thead th')].map(th => th.textContent)).toEqual(['Place', 'Athlete', 'Team', 'Region', 'Points'])
    expect(rows().map(row => row.querySelector('.nat-reg').textContent)).toEqual(['National list', 'National list', 'National list'])
    expect(rows().map(row => row.querySelector('td.t').textContent)).toEqual(['6,230', '6,050', 'DNF'])
    expect(screen.getByRole('list', { name: 'The field' }).textContent).toBe('Qualifiers 3 from the national list')
    expect(screen.getByText(/The heptathlon has no First Round: the top 24 declared on the national list go to nationals\./)).toBeTruthy()
  })

  it('puts a field event’s no mark under the final, and leaves out the final count with one round', async () => {
    await openMeet('/?g=f&s=outdoor&r=East&y=2026&event=long-jump&view=nationals')
    await screen.findByRole('heading', { level: 1, name: 'Women’s long jump, nationals' })
    expect(names()).toEqual(['Pia Bounder', 'Ola Leaper', 'Nina Jumper'])
    expect(rows().map(row => row.querySelector('td.t').textContent)).toEqual(['6.88', '6.75', 'NM'])
    expect(rows()[1].querySelector('td.wind').textContent).toBe('wind +1.4')
    expect(screen.getByRole('list', { name: 'East and West' }).textContent).not.toContain('Final')
  })

  it('shows qualifiers in seed order before any results', async () => {
    await openMeet('/?g=f&s=outdoor&r=East&y=2026&event=400m&view=nationals')
    await screen.findByRole('heading', { level: 1, name: 'Women’s 400m, nationals' })
    expect([...document.querySelectorAll('table.nat thead th')].map(th => th.textContent)).toEqual(['#', 'Athlete', 'Team', 'Region', 'First Round', 'Seed'])
    expect(names()).toEqual(['Ida Quick', 'Fay Turn', 'Bea Lap'])
    expect(rows().map(row => row.querySelector('td.pl').textContent)).toEqual(['1', '2', '3'])
    expect(document.querySelectorAll('tr.nat-grp')).toHaveLength(0)
    expect(screen.getByRole('list', { name: 'East and West' }).textContent).toBe('Qualifiers 1 East, 2 West')
  })

  it('lists the meet’s events beside the sheet with the winning marks, and keeps to nationals', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    const nav = screen.getByRole('navigation', { name: 'Events' })
    const links = within(nav).getAllByRole('link')
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual(['100m, 10.80', '400m', 'Long jump, 6.88\u00A0m', 'Heptathlon, 6,230\u00A0pts'])
    expect(links[0].getAttribute('aria-current')).toBe('page')
    fireEvent.click(links[2])
    expect(window.location.search).toBe('?g=f&s=outdoor&r=East&y=2026&event=long-jump&view=nationals')
    expect(await screen.findByRole('heading', { level: 1, name: 'Women’s long jump, nationals' })).toBeTruthy()
  })

  it('offers the meet’s own years in the year menu, back to 2019', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    const menu = screen.getByRole('combobox', { name: 'Outdoor season' })
    expect([...menu.options].map(option => option.textContent)).toEqual(['2026', '2019'])
    fireEvent.change(menu, { target: { value: '2019' } })
    expect(window.location.search).toBe('?g=f&s=outdoor&r=East&y=2019&event=100m&view=nationals')
    await waitFor(() => expect(document.querySelector('.nat-meet').textContent).toContain('2019'))
    expect(fetched()).toContain('nationals-outdoor-2019-f.json')
  })

  it('loads only index.json and the meet, not the regional lists', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    expect(fetched().sort()).toEqual(['index.json', 'nationals-outdoor-2026-f.json'])
  })

  it('drops a year with no meet from the link and shows the latest', async () => {
    await openMeet('/?g=f&s=outdoor&r=East&y=2024&event=100m&view=nationals')
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(window.location.search).toBe('?g=f&s=outdoor&r=East&event=100m&view=nationals'))
    expect(screen.getByRole('combobox', { name: 'Outdoor season' }).value).toBe('2026')
  })

  it('says so when the meet file fails to load, and Try again loads it', async () => {
    let broken = true
    await openMeet(undefined, { fail: name => (broken && name.startsWith('nationals-') ? '404' : null) })
    expect(await screen.findByText('The nationals results could not be loaded.')).toBeTruthy()
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, nationals' })).toBeTruthy()
  })

  it('treats a file that is not a national meet as missing', async () => {
    const site = nationalsSite()
    site['nationals-outdoor-2026-f.json'] = { events: 'nope' }
    await openMeet(undefined, { site })
    expect(await screen.findByText('The nationals results could not be loaded.')).toBeTruthy()
  })
})

describe('the Nationals entry', () => {
  it('sits beside East and West outdoors when there is a meet, and opens it for the event shown', async () => {
    await openMeet('/?g=f&s=outdoor&r=West&event=100m')
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    const link = within(filters()).getByRole('link', { name: 'Nationals' })
    expect(link.getAttribute('href')).toBe('?g=f&s=outdoor&r=West&event=100m&view=nationals')
    expect(link.hasAttribute('aria-current')).toBe(false)
    expect(within(filters()).getByRole('link', { name: 'West' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, nationals' })).toBeTruthy()
    expect(within(filters()).getByRole('link', { name: 'Nationals' }).getAttribute('aria-current')).toBe('page')
    // On the meet neither region is current, and each goes back to its own event page.
    const west = within(filters()).getByRole('link', { name: 'West' })
    expect(west.hasAttribute('aria-current')).toBe(false)
    expect(west.getAttribute('href')).toBe('?g=f&s=outdoor&r=West&event=100m')
    expect(within(filters()).getByRole('link', { name: 'Women' }).getAttribute('aria-current')).toBe('page')
  })

  it('is not offered indoors, or for a gender with no meet', async () => {
    await openMeet('/?g=m&s=outdoor&r=East&event=100m')
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    expect(within(filters()).queryByRole('link', { name: 'Nationals' })).toBeNull()
    expect(within(filters()).getByRole('link', { name: 'Indoor' }).getAttribute('href')).not.toContain('nationals')
  })

  it('is in the phone picker next to Every qualifying line', async () => {
    await openMeet(undefined, { width: 390 })
    fireEvent.click(await screen.findByRole('button', { name: /^Change event, gender or season\. Now: Women’s 100m, nationals, 2026/ }))
    const sheet = document.querySelector('dialog.sheet')
    const board = within(sheet).getByRole('link', { name: 'Every qualifying line' })
    const nationals = within(sheet).getByRole('link', { name: 'Nationals' })
    expect(board.nextElementSibling).toBe(nationals)
    expect(nationals.getAttribute('aria-current')).toBe('page')
    expect(within(sheet).getByRole('link', { name: 'Long jump, 6.88' }).getAttribute('href')).toContain('view=nationals')
  })
})

describe('without nationals in index.json', () => {
  it('offers no Nationals entry and loads no meet', async () => {
    await openMeet('/?g=f&s=outdoor&r=East&event=100m', { site: nationalsSite({ nationals: false }) })
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    expect(within(filters()).queryByRole('link', { name: 'Nationals' })).toBeNull()
    expect(within(filters()).getAllByRole('link').map(link => link.textContent)).toEqual(['Men', 'Women', 'Indoor', 'Outdoor', 'East', 'West'])
    expect(fetched().some(name => name.startsWith('nationals-'))).toBe(false)
  })

  it('opens the event page for a nationals link, and the link drops the view', async () => {
    await openMeet('/?g=f&s=outdoor&r=East&event=100m&view=nationals', { site: nationalsSite({ nationals: false }) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, East' })).toBeTruthy()
    await waitFor(() => expect(window.location.search).toBe('?g=f&s=outdoor&r=East&event=100m'))
    expect(document.querySelector('.nat-hero')).toBeNull()
  })

  it('treats an empty nationals list the same way', async () => {
    const site = nationalsSite({ nationals: false })
    site['index.json'] = { ...site['index.json'], nationals: [] }
    await openMeet('/?g=f&s=outdoor&r=East&event=100m&view=nationals', { site })
    expect(await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, East' })).toBeTruthy()
    expect(within(filters()).queryByRole('link', { name: 'Nationals' })).toBeNull()
  })
})

describe('the regional event page’s nationals card', () => {
  const data = nationalsFile()

  it('says how many went and the best finish, and links to that event at nationals', () => {
    render(<NationalsCard event="100 Meters" region="East" gender="f" year="2026" data={data} />)
    const link = screen.getByRole('link')
    expect(link.textContent).toBe('Nationals12 went to nationals · best finish 2ndThe national meet')
    expect(link.getAttribute('href')).toBe('?g=f&s=outdoor&r=East&y=2026&event=100m&view=nationals')
    cleanup()
    render(<NationalsCard event="100 Meters" region="West" gender="f" year="2026" data={data} />)
    expect(screen.getByRole('link').textContent).toContain('12 went to nationals · best finish 1st')
  })

  it('counts only before results, and matches the event by its label', () => {
    render(<NationalsCard event="400 Meters" region="West" gender="f" year="2026" data={data} />)
    expect(screen.getByRole('link').textContent).toContain('2 went to nationals')
    expect(screen.getByRole('link').textContent).not.toContain('best')
    expect(wentOn(data, '400 Meters', 'West')).toMatchObject({ count: 2, best: null, results: false, listRanks: [2, 4] })
  })

  it('shows nothing for the multis, a missing event, a bad file or no file', () => {
    for (const props of [
      { event: 'Heptathlon', data },
      { event: '800 Meters', data },
      { event: '100 Meters', data: { events: 'nope' } },
      { event: '100 Meters', data: null },
      { event: '100 Meters', data, region: 'National' },
    ]) {
      const { container } = render(<NationalsCard region="East" gender="f" year="2026" {...props} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('goes through the app’s navigation on a plain click', () => {
    const go = vi.fn()
    render(<NationalsCard event="100 Meters" region="East" gender="f" year="2026" data={data} go={go} />)
    fireEvent.click(screen.getByRole('link'), { button: 0 })
    expect(go).toHaveBeenCalledTimes(1)
    expect(go.mock.calls[0][0]).toContain('view=nationals')
    fireEvent.click(screen.getByRole('link'), { button: 0, metaKey: true })
    expect(go).toHaveBeenCalledTimes(1)
  })
})

describe('nationals accessibility', () => {
  it('offers the skip link to the sheet, which takes focus without becoming a tab stop', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    const skip = screen.getByRole('link', { name: 'Skip to the list' })
    fireEvent.click(skip, { button: 0 })
    const table = screen.getByRole('table', { name: 'Women’s 100m, nationals, in final order' })
    expect(document.activeElement).toBe(table)
    expect(table.getAttribute('tabindex')).toBe('-1')
  })

  it('names every column and heads each break in the sheet as a row group', async () => {
    await openMeet()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Place', 'Athlete', 'Team', 'Region', 'First Round', 'Time', 'Wind'])
    const groups = [...document.querySelectorAll('tr.nat-grp th')]
    expect(groups.every(th => th.getAttribute('scope') === 'rowgroup' && th.getAttribute('colspan') === '7')).toBe(true)
  })

  it('gives the region chips and dashes words a screen reader can read', async () => {
    await openMeet('/?g=f&s=outdoor&r=East&y=2026&event=heptathlon&view=nationals')
    await screen.findByRole('heading', { level: 1 })
    expect(rows()[2].querySelector('td.pl').textContent).toBe('—No place')
    expect(rows()[2].querySelector('td.pl [aria-hidden="true"]').textContent).toBe('—')
  })
})
