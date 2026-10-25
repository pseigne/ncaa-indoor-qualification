import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../src/App'
import NationalsCard from '../src/components/NationalsCard'
import {
  nationalsEntries, nationalsEvents, orderQualifiers, readNationals, regionSummary, summaryParts, wentOn,
} from '../src/utils/nationals'
import { href, readQuery } from '../src/utils/route'
import { nationalsFile, nationalsSite } from './nationals'
import { fetched, savedFile, serveSite } from './site'

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

async function openPage(url = '/?g=f&s=outdoor&r=East&event=100m&detail=nationals', { width = 1440, site = nationalsSite(), fail } = {}) {
  screenAt(width)
  window.history.replaceState(null, '', url)
  serveSite(site, { fail })
  render(<App />)
}

// The nationals dialog, once its meet has loaded.
const sheet = (name = 'Women’s 100m, East Nationals') => screen.findByRole('dialog', { name })
const rows = () => [...document.querySelectorAll('dialog table.nat tbody tr:not(.nat-grp)')]
const names = () => rows().map(row => row.querySelector('td.ath').textContent)
const stats = () => [...document.querySelectorAll('dialog .stats > div')].map(item => item.textContent)
const card = () => document.querySelector('a.detail-card[data-detail="nationals"]')
const filters = () => screen.getByRole('navigation', { name: 'Season and gender' })

describe('the nationals dialog link', () => {
  it('reads and writes detail=nationals outdoors, over the regional event page', () => {
    const query = readQuery('?g=f&s=outdoor&r=East&y=2026&event=100m&detail=nationals')
    expect(query).toMatchObject({ view: 'event', gender: 'f', season: 'outdoor', region: 'East', year: '2026', event: '100m', detail: 'nationals' })
    expect(href(query)).toBe('?g=f&s=outdoor&r=East&y=2026&event=100m')
  })

  it('opens no nationals dialog indoors, and has no nationals page', () => {
    expect(readQuery('?g=f&s=indoor&event=mile&detail=nationals').detail).toBe('')
    expect(readQuery('?g=f&s=outdoor&r=East&event=100m&view=nationals').view).toBe('event')
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

describe('the nationals dialog', () => {
  it('opens over the regional event page and shows the 24 qualifiers as a heat sheet in final order', async () => {
    await openPage()
    expect(await sheet()).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Women’s 100m, East' })).toBeTruthy()
    expect(document.title).toBe('Women’s 100m, East at nationals · NCAA TF Qualification Monitor')
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
    await openPage()
    await sheet()
    const chips = rows().slice(0, 3).map(row => row.querySelector('.nat-reg'))
    expect(chips.map(chip => chip.className)).toEqual(['nat-reg west', 'nat-reg east', 'nat-reg east'])
    expect(chips.map(chip => chip.textContent)).toEqual(['WWest', 'EEast', 'EEast'])
    expect(chips[0].querySelector('[aria-hidden="true"]').textContent).toBe('W')
    expect(chips[0].querySelector('.vh').textContent).toBe('West')
  })

  it('names the round for those out before the final and puts no results at the bottom', async () => {
    await openPage()
    await sheet()
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

  it('names the meet, explains how the field was made, and counts East against West', async () => {
    await openPage()
    await sheet()
    expect(document.querySelector('dialog .nat-meet').textContent).toBe('NCAA Division I Outdoor Track & Field Championships, from June 10, 2026.')
    expect(document.querySelector('dialog .detail-lead').textContent).toMatch(/The top 12 athletes in each event at each First Round, East and West, go on to nationals, 24 in all\. A place left by a scratch at nationals is not filled\.$/)
    expect(stats()).toEqual(['Qualifiers12 East, 12 West', 'Final5 East, 4 West', 'Top 85 East, 3 West', 'Points22 East, 17 West'])
  })

  it('links the meet’s sources and nothing that is not a web link', async () => {
    await openPage()
    await sheet()
    const source = document.querySelector('dialog .source')
    expect(source.textContent).toBe('Source: RecordTiming qualifier list · Flash Results.')
    expect([...source.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual([
      'https://www.rtspt.com/ncaa/d1outdoor26/women_qualifiers.htm',
      'https://www.flashresults.com/2026_Meets/Outdoor/06-10_NCAA/index.htm',
    ])
  })

  it('shows the multis from the national list, with no First Round column', async () => {
    await openPage('/?g=f&s=outdoor&r=West&event=heptathlon&detail=nationals')
    await sheet('Women’s heptathlon, West Nationals')
    expect([...document.querySelectorAll('dialog table.nat thead th')].map(th => th.textContent)).toEqual(['Place', 'Athlete', 'Team', 'Region', 'Points'])
    expect(rows().map(row => row.querySelector('.nat-reg').textContent)).toEqual(['National list', 'National list', 'National list'])
    expect(rows().map(row => row.querySelector('td.t').textContent)).toEqual(['6,230', '6,050', 'DNF'])
    expect(stats()).toEqual(['Qualifiers3 from the national list'])
    expect(document.querySelector('dialog .detail-lead').textContent).toContain('The heptathlon has no First Round: the top 24 declared on the national list go to nationals.')
  })

  it('puts a field event’s no mark under the final, and leaves out the final count with one round', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=long-jump&detail=nationals')
    await sheet('Women’s long jump, East Nationals')
    expect(names()).toEqual(['Pia Bounder', 'Ola Leaper', 'Nina Jumper'])
    expect(rows().map(row => row.querySelector('td.t').textContent)).toEqual(['6.88', '6.75', 'NM'])
    expect(rows()[1].querySelector('td.wind').textContent).toBe('wind +1.4')
    expect(stats().join(' ')).not.toContain('Final')
  })

  it('shows qualifiers in seed order before any results', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=400m&detail=nationals')
    await sheet('Women’s 400m, East Nationals')
    expect([...document.querySelectorAll('dialog table.nat thead th')].map(th => th.textContent)).toEqual(['#', 'Athlete', 'Team', 'Region', 'First Round', 'Seed'])
    expect(names()).toEqual(['Ida Quick', 'Fay Turn', 'Bea Lap'])
    expect(rows().map(row => row.querySelector('td.pl').textContent)).toEqual(['1', '2', '3'])
    expect(document.querySelectorAll('tr.nat-grp')).toHaveLength(0)
    expect(stats()).toEqual(['Qualifiers1 East, 2 West'])
  })

  it('closes back to the event page, and Back closes it when the card opened it', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=100m')
    await waitFor(() => expect(card()).not.toBeNull())
    fireEvent.click(card(), { button: 0 })
    expect(window.location.search).toBe('?g=f&s=outdoor&r=East&event=100m&detail=nationals')
    await sheet()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(document.querySelector('dialog.detail')).toBeNull())
    expect(screen.getByRole('heading', { level: 1, name: 'Women’s 100m, East' })).toBeTruthy()
  })

  it('opens for the year shown, from that year’s meet', async () => {
    const site = nationalsSite()
    await openPage('/?g=f&s=outdoor&r=East&y=2026&event=100m&detail=nationals', { site })
    await sheet()
    expect(fetched()).toContain('nationals-outdoor-2026-f.json')
    expect(fetched()).not.toContain('nationals-outdoor-2019-f.json')
  })

  it('leaves the event page as it is when the meet fails to load, has no such event or is not a meet', async () => {
    await openPage(undefined, { fail: name => (name.startsWith('nationals-') ? '404' : null) })
    await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, East' })
    await waitFor(() => expect(fetched()).toContain('nationals-outdoor-2026-f.json'))
    expect(document.querySelector('dialog.detail')).toBeNull()
    expect(screen.queryByText('The qualifying lists could not be loaded.')).toBeNull()
    cleanup()
    const site = nationalsSite()
    site['nationals-outdoor-2026-f.json'] = { events: 'nope' }
    await openPage(undefined, { site })
    await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, East' })
    await waitFor(() => expect(fetched()).toContain('nationals-outdoor-2026-f.json'))
    expect(document.querySelector('dialog.detail')).toBeNull()
    expect(card()).toBeNull()
  })
})

describe('the nav', () => {
  it('offers East and West outdoors and no Nationals entry, even with a meet', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=100m')
    await waitFor(() => expect(card()).not.toBeNull())
    expect(within(filters()).getAllByRole('link').map(link => link.textContent)).toEqual(['Men', 'Women', 'Indoor', 'Outdoor', 'East', 'West'])
  })

  it('has no Nationals entry in the phone menu', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=100m', { width: 390 })
    fireEvent.click(await screen.findByRole('button', { name: /^Change event or season\. Now: Women’s 100m, East/ }))
    const picker = document.querySelector('dialog.menu')
    expect(within(picker).queryByRole('link', { name: 'Nationals' })).toBeNull()
  })
})

describe('without nationals in index.json', () => {
  it('loads no meet and shows no card, and a nationals link shows the event page', async () => {
    await openPage(undefined, { site: nationalsSite({ nationals: false }) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Women’s 100m, East' })).toBeTruthy()
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    expect(fetched().some(name => name.startsWith('nationals-'))).toBe(false)
    expect(card()).toBeNull()
    expect(document.querySelector('dialog.detail')).toBeNull()
  })
})

describe('the regional event page’s nationals card', () => {
  const data = nationalsFile()
  const query = (region = 'East', event = '100m') => ({ view: 'event', gender: 'f', season: 'outdoor', region, year: '2026', event, day: '' })

  it('says how many went and the best finish, and opens the nationals dialog', () => {
    render(<NationalsCard event="100 Meters" query={query()} data={data} />)
    const link = screen.getByRole('link')
    expect(link.textContent).toBe('Nationals12 went to nationals · best finish 2ndThe national meet')
    expect(link.getAttribute('href')).toBe('?g=f&s=outdoor&r=East&y=2026&event=100m&detail=nationals')
    expect(link.getAttribute('aria-haspopup')).toBe('dialog')
    cleanup()
    render(<NationalsCard event="100 Meters" query={query('West')} data={data} />)
    expect(screen.getByRole('link').textContent).toContain('12 went to nationals · best finish 1st')
  })

  it('counts only before results, and matches the event by its label', () => {
    render(<NationalsCard event="400 Meters" query={query('West', '400m')} data={data} />)
    expect(screen.getByRole('link').textContent).toContain('2 went to nationals')
    expect(screen.getByRole('link').textContent).not.toContain('best')
    expect(wentOn(data, '400 Meters', 'West')).toMatchObject({ count: 2, best: null, results: false, listRanks: [2, 4] })
  })

  it('counts the whole field for the multis, with no places to tag', () => {
    render(<NationalsCard event="Heptathlon" query={query('East', 'heptathlon')} data={data} />)
    expect(screen.getByRole('link').textContent).toContain('3 went to nationals from the national list')
    expect(wentOn(data, 'Heptathlon', 'East')).toMatchObject({ multi: true, count: 3, listRanks: [] })
  })

  it('shows nothing for a missing event, a bad file, no file or no region', () => {
    for (const props of [
      { event: '800 Meters', data },
      { event: '100 Meters', data: { events: 'nope' } },
      { event: '100 Meters', data: null },
      { event: '100 Meters', data, query: query('National') },
    ]) {
      const { container } = render(<NationalsCard query={query()} {...props} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('goes through the app’s navigation on a plain click', () => {
    const go = vi.fn()
    render(<NationalsCard event="100 Meters" query={query()} data={data} go={go} />)
    fireEvent.click(screen.getByRole('link'), { button: 0 })
    expect(go).toHaveBeenCalledTimes(1)
    expect(go.mock.calls[0][0]).toContain('detail=nationals')
    fireEvent.click(screen.getByRole('link'), { button: 0, metaKey: true })
    expect(go).toHaveBeenCalledTimes(1)
  })
})

describe('a regional event page with the national meet imported', () => {
  // The women's 100m fixture sends these places on the East list to nationals.
  const EAST = [2, 3, 5, 6, 8, 10, 11, 12, 13, 14, 15, 23]
  const tagged = () => [...document.querySelectorAll('tr[data-rank]')]
    .filter(row => row.querySelector('.tag-nat')).map(row => Number(row.dataset.rank))

  it('loads that year’s meet and shows the nationals card beside the other cards', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=100m')
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    await waitFor(() => expect(card()).not.toBeNull())
    expect(fetched()).toContain('nationals-outdoor-2026-f.json')
    expect(card().textContent).toBe('Nationals12 went to nationals · best finish 2ndThe national meet')
    expect(card().closest('.details')).not.toBeNull()
  })

  it('tags the places that went to nationals from this First Round, in words a screen reader reads', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=100m')
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    await waitFor(() => expect(tagged()).toEqual(EAST))
    const row = document.querySelector('tr[data-rank="2"]')
    expect(row.querySelector('.tag-nat').textContent).toBe('Ticket Punched')
    expect(row.querySelector('.tag-nat img').getAttribute('alt')).toBe('')
    expect(row.getAttribute('aria-label')).toMatch(/, went to nationals$/)
    expect(document.querySelector('tr[data-rank="4"]').getAttribute('aria-label')).not.toContain('nationals')
  })

  it('counts the West’s own qualifiers on the West page', async () => {
    await openPage('/?g=f&s=outdoor&r=West&event=100m')
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    await waitFor(() => expect(card()?.textContent).toContain('12 went to nationals · best finish 1st'))
    expect(tagged()).toEqual([1, 4, 7, 9, 16, 17, 18, 19, 20, 21, 22, 24])
  })

  it('asks for no meet for a gender without one, and shows no card or tags', async () => {
    await openPage('/?g=m&s=outdoor&r=East&event=100m')
    await screen.findByText('48', { selector: 'tr.bubble .pl' })
    expect(fetched().some(name => name.startsWith('nationals-'))).toBe(false)
    expect(card()).toBeNull()
    expect(tagged()).toEqual([])
  })
})

describe('the published nationals files', () => {
  const index = savedFile('index.json')

  it('are each listed once in index.json, and the dialog reads every event and qualifier in them', () => {
    expect(index.nationals.length).toBeGreaterThan(0)
    expect(new Set(index.nationals.map(item => item.file)).size).toBe(index.nationals.length)
    for (const item of index.nationals) {
      const raw = savedFile(item.file)
      const read = readNationals(raw)
      expect(read, item.file).not.toBeNull()
      expect([read.year, read.gender]).toEqual([item.year, item.gender])
      expect(read.events.map(event => event.qualifiers.length)).toEqual(raw.events.map(event => event.qualifiers.length))
      expect(read.sources.length).toBe(raw.sources.length)
    }
  })

  it('show the 2026 women’s 100m final in order, East and West', async () => {
    const site = Object.fromEntries(['index.json', 'outdoor-2026-f-East.json', 'history-outdoor-f.json', 'nationals-outdoor-2026-f.json']
      .map(name => [name, savedFile(name)]))
    await openPage('/?g=f&s=outdoor&r=East&y=2026&event=100m&detail=nationals', { site })
    await sheet()
    expect(names().slice(0, 3)).toEqual(['Shenese Walker', 'Adaejah Hodge', 'Shawnti Jackson'])
    expect(rows()[0].querySelector('td.pl').textContent).toBe('1')
    expect(rows().length).toBe(24)
  })
})

describe('nationals accessibility', () => {
  it('names the sheet, every column and each break in it as a row group', async () => {
    await openPage()
    const dialog = await sheet()
    expect(within(dialog).getByRole('table', { name: '100m at nationals, in final order' })).toBeTruthy()
    expect(within(dialog).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Place', 'Athlete', 'Team', 'Region', 'First Round', 'Time', 'Wind'])
    const groups = [...dialog.querySelectorAll('tr.nat-grp th')]
    expect(groups.every(th => th.getAttribute('scope') === 'rowgroup' && th.getAttribute('colspan') === '7')).toBe(true)
  })

  it('gives the region chips and dashes words a screen reader can read', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=heptathlon&detail=nationals')
    await sheet('Women’s heptathlon, East Nationals')
    expect(rows()[2].querySelector('td.pl').textContent).toBe('—No place')
    expect(rows()[2].querySelector('td.pl [aria-hidden="true"]').textContent).toBe('—')
  })

  it('returns focus to the card when the dialog closes', async () => {
    await openPage('/?g=f&s=outdoor&r=East&event=100m')
    await waitFor(() => expect(card()).not.toBeNull())
    fireEvent.click(card(), { button: 0 })
    await sheet()
    fireEvent.keyDown(document.querySelector('dialog.detail'), { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('dialog.detail')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(card()))
  })
})
