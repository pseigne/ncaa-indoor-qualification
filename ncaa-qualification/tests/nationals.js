import { siteFiles } from './site'

// A national meet as nationals.py writes nationals-outdoor-{year}-{g}.json, for women's 2026, with each
// event's qualifiers out of order so the page has to sort them.
//
// 100m: nine in the final (places 1–9, five East and four West), thirteen out in the semifinals, one who
// did not finish her semifinal and one who did not start. Long jump: one round, with a no mark.
// Heptathlon: three from the national list. 400m: qualifiers only, before any results.
export const FINAL = ['West', 'East', 'East', 'West', 'East', 'East', 'West', 'East', 'West']
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1]

function sprinter(n, region, extra = {}) {
  return {
    athlete: `Runner${n}, Ann`,
    team: `School ${n}`,
    region,
    listRank: n,
    seed: (11 + n / 100).toFixed(2),
    firstRound: { place: ((n - 1) % 12) + 1, mark: (11.1 + n / 100).toFixed(2), wind: '+1.0', q: n % 3 ? 'Q' : 'q' },
    nationals: null,
    ...extra,
  }
}

function hundred() {
  const finalists = FINAL.map((region, at) => sprinter(at + 1, region, {
    nationals: { place: at + 1, round: 'final', mark: (10.8 + at / 50).toFixed(2), wind: '-0.4', status: null, points: POINTS[at] ?? null },
  }))
  // Six more East and seven more West, then the two below, make twelve of each.
  const semis = Array.from({ length: 13 }, (_, at) => sprinter(10 + at, at < 6 ? 'East' : 'West', {
    nationals: { place: null, round: 'semifinal', mark: (11.3 + at / 50).toFixed(2), wind: '+0.2', status: null, points: null },
  }))
  const dnf = sprinter(23, 'East', { nationals: { place: null, round: 'semifinal', mark: null, wind: null, status: 'DNF', points: null } })
  const dns = sprinter(24, 'West', { nationals: { place: null, round: 'semifinal', mark: null, wind: null, status: 'DNS', points: null } })
  // Shuffled: statuses first, the semifinalists reversed, the final last to first.
  return [dns, dnf, ...semis.reverse(), ...finalists.reverse()]
}

function longJump() {
  return [
    { athlete: 'Jumper, Nina', team: 'Texas', region: 'West', listRank: 3, seed: '6.70', firstRound: { place: 2, mark: '6.55', wind: '+1.1', q: 'Q' }, nationals: { place: null, round: 'final', mark: null, wind: null, status: 'NM', points: null } },
    { athlete: 'Leaper, Ola', team: 'Florida', region: 'East', listRank: 1, seed: '6.90', firstRound: { place: 1, mark: '6.80', wind: '+0.5', q: 'Q' }, nationals: { place: 2, round: 'final', mark: '6.75', wind: '+1.4', status: null, points: 8 } },
    { athlete: 'Bounder, Pia', team: 'Oregon', region: 'West', listRank: 2, seed: '6.85', firstRound: { place: 1, mark: '6.70', wind: '-0.2', q: 'Q' }, nationals: { place: 1, round: 'final', mark: '6.88', wind: '+2.1', status: null, points: 10 } },
  ]
}

function heptathlon() {
  return [
    { athlete: 'Multi, Cara', team: 'Georgia', region: 'National', listRank: 2, seed: '6100', firstRound: null, nationals: { place: 2, round: 'final', mark: '6050', wind: null, status: null, points: 8 } },
    { athlete: 'Combo, Dee', team: 'Kansas', region: 'National', listRank: 1, seed: '6200', firstRound: null, nationals: { place: 1, round: 'final', mark: '6230', wind: null, status: null, points: 10 } },
    { athlete: 'Seven, Eve', team: 'LSU', region: 'National', listRank: 3, seed: '5900', firstRound: null, nationals: { place: null, round: 'final', mark: null, wind: null, status: 'DNF', points: null } },
  ]
}

function four() {
  return [
    { athlete: 'Lap, Bea', team: 'USC', region: 'West', listRank: 4, seed: '51.20', firstRound: { place: 3, mark: '51.40', wind: null, q: 'Q' }, nationals: null },
    { athlete: 'Quick, Ida', team: 'LSU', region: 'East', listRank: 1, seed: '50.10', firstRound: { place: 1, mark: '50.50', wind: null, q: 'Q' }, nationals: null },
    { athlete: 'Turn, Fay', team: 'Baylor', region: 'West', listRank: 2, seed: '50.80', firstRound: { place: 1, mark: '50.90', wind: null, q: 'q' }, nationals: null },
  ]
}

export function nationalsFile({ year = '2026', gender = 'f' } = {}) {
  return {
    season: 'outdoor',
    year,
    gender,
    meet: { name: 'NCAA Division I Outdoor Track & Field Championships', start_date: `${year}-06-10` },
    sources: [
      { label: 'RecordTiming qualifier list', url: 'https://www.rtspt.com/ncaa/d1outdoor26/women_qualifiers.htm' },
      { label: 'Flash Results', url: 'https://www.flashresults.com/2026_Meets/Outdoor/06-10_NCAA/index.htm' },
      { label: 'Not a link', url: 'javascript:alert(1)' },
    ],
    events: [
      { event: 'Heptathlon', qualifiers: heptathlon() },
      { event: 'Long Jump', qualifiers: longJump() },
      { event: '400 Meters', qualifiers: four() },
      { event: '100 Meters', qualifiers: hundred() },
    ],
  }
}

// One regional list per region for women's outdoor 2026 and men's, so the event pages have something.
// Women's also have the meet's other events, so each one's nationals dialog can open.
function regionalList(event, region, gender, mark, rank = 48) {
  const rankings = Array.from({ length: 50 }, (_, at) => ({
    rank: at + 1, athlete: `Sprinter${at + 1}, ${region}`, team: `School ${at + 1}`, time: mark(at),
  }))
  return {
    year: '2026', season: 'outdoor', region, gender, event, rankings,
    qualification: { rank, is_relay: false, status: 'available', entry: { ...rankings[rank - 1] } },
  }
}

function regionalLists(region, gender) {
  const lists = [regionalList('100 Meters', region, gender, at => (11 + at / 100).toFixed(2))]
  if (gender === 'f') {
    lists.push(
      regionalList('400 Meters', region, gender, at => (50 + at / 10).toFixed(2)),
      regionalList('Long Jump', region, gender, at => (6.9 - at / 100).toFixed(2)),
      regionalList('Heptathlon', region, gender, at => String(6200 - at * 10), 24),
    )
  }
  return lists
}

// Site files with the national meet listed for women in 2026 and 2019, or, with `nationals: false`,
// index.json exactly as today's, with no "nationals" key.
export function nationalsSite({ nationals = true } = {}) {
  const files = siteFiles(['East', 'West'].flatMap(region => ['f', 'm'].flatMap(gender => regionalLists(region, gender))))
  if (!nationals) return files
  files['nationals-outdoor-2026-f.json'] = nationalsFile()
  files['nationals-outdoor-2019-f.json'] = nationalsFile({ year: '2019' })
  files['index.json'] = {
    ...files['index.json'],
    nationals: [
      { season: 'outdoor', year: '2019', gender: 'f', file: 'nationals-outdoor-2019-f.json' },
      { season: 'outdoor', year: '2026', gender: 'f', file: 'nationals-outdoor-2026-f.json' },
    ],
  }
  return files
}
