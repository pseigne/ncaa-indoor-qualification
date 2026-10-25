export const DETAILS = ['season', 'history', 'nationals']

// The season, past years and, outdoors only, the national meet open as dialogs over the event page. The
// old season page, view=season, now opens the season dialog.
export function readQuery(search = '') {
  const q = new URLSearchParams(search)
  const season = q.get('s') === 'outdoor' ? 'outdoor' : 'indoor'
  const legacy = q.get('view') === 'season'
  const asked = DETAILS.includes(q.get('detail')) && (q.get('detail') !== 'nationals' || season === 'outdoor')
  const detail = legacy ? 'season' : asked ? q.get('detail') : ''
  return {
    view: q.get('view') === 'board' ? 'board' : 'event',
    gender: q.get('g') === 'f' ? 'f' : 'm',
    season,
    region: q.get('r') === 'West' ? 'West' : 'East',
    event: q.get('event') || '',
    day: q.get('d') || '',
    // The season's last calendar year: 2025 is indoor 2024–25 and outdoor 2025. Empty means the latest.
    year: /^\d{4}$/.test(q.get('y') || '') ? q.get('y') : '',
    detail,
    legacy,
  }
}

// Links spread the query, so a dialog is never carried along: only detailHref opens one.
export function href({ view = 'event', gender = 'm', season = 'indoor', region = 'East', event = '', day = '', year = '' } = {}) {
  const q = new URLSearchParams()
  q.set('g', gender)
  q.set('s', season)
  if (season === 'outdoor') q.set('r', region)
  if (year) q.set('y', year)
  if (event) q.set('event', event)
  if (view !== 'event') q.set('view', view)
  if (day) q.set('d', day)
  return `?${q.toString()}`
}

export function detailHref(query, detail, slug = query.event) {
  const base = href({ ...query, view: 'event', event: slug, day: detail === 'season' ? query.day : '' })
  return detail ? `${base}&detail=${detail}` : base
}

// The last calendar year of a season key: 2025 for 2024-2025 and for 2025.
export function endYear(key) {
  return String(key).split('-').at(-1)
}

// How a season reads in the year menu: 2024–25 indoors, 2025 outdoors.
export function yearLabel(key) {
  const [start, end] = String(key).split('-')
  return end ? `${start}–${end.slice(2)}` : start
}

const LISTS = {
  'indoor|2025-2026|National': {
    href: 'https://www.tfrrs.org/lists/5352/2025_2026_NCAA_Division_I_Indoor_List_FINAL',
    title: '2025–2026 NCAA Division I indoor list',
  },
  'outdoor|2026|East': {
    href: 'https://www.tfrrs.org/lists/5622/2026_NCAA_Div_I_East_Outdoor_List_FINAL',
    title: '2026 NCAA Division I East outdoor list',
  },
  'outdoor|2026|West': {
    href: 'https://www.tfrrs.org/lists/5623/2026_NCAA_Div_I_West_Outdoor_List_FINAL',
    title: '2026 NCAA Division I West outdoor list',
  },
}

export function listLink(season, year, region) {
  const key = `${season}|${year}|${season === 'indoor' ? 'National' : region}`
  return LISTS[key] || null
}

export function plainClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
