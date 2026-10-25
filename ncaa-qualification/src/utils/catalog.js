// Meet order, distances, and short names for the heat sheet.
// A distance means the race strip can place the field; field events and combined events have none.

export const GROUP_ORDER = ['Sprints and hurdles', 'Distance', 'Relays', 'Field and multis']

const INDOOR = [
  ['60 Meters', '60m', 60, 'time', 'Sprints and hurdles'],
  ['60 Hurdles', '60m hurdles', 60, 'time', 'Sprints and hurdles'],
  ['200 Meters', '200m', 200, 'time', 'Sprints and hurdles'],
  ['400 Meters', '400m', 400, 'time', 'Sprints and hurdles'],
  ['800 Meters', '800m', 800, 'time', 'Distance'],
  ['Mile', 'Mile', 1609.34, 'time', 'Distance'],
  ['3000 Meters', '3000m', 3000, 'time', 'Distance'],
  ['5000 Meters', '5000m', 5000, 'time', 'Distance'],
  ['4 x 400 Relay', '4×400m relay', 1600, 'time', 'Relays'],
  ['Distance Medley Relay', 'Distance medley relay', 4000, 'time', 'Relays'],
  ['High Jump', 'High jump', null, 'mark', 'Field and multis'],
  ['Pole Vault', 'Pole vault', null, 'mark', 'Field and multis'],
  ['Long Jump', 'Long jump', null, 'mark', 'Field and multis'],
  ['Triple Jump', 'Triple jump', null, 'mark', 'Field and multis'],
  ['Shot Put', 'Shot put', null, 'mark', 'Field and multis'],
  ['Weight Throw', 'Weight throw', null, 'mark', 'Field and multis'],
  ['Heptathlon', 'Heptathlon', null, 'points', 'Field and multis'],
  ['Pentathlon', 'Pentathlon', null, 'points', 'Field and multis'],
]

const OUTDOOR = [
  ['100 Meters', '100m', 100, 'time', 'Sprints and hurdles'],
  ['110 Hurdles', '110m hurdles', 110, 'time', 'Sprints and hurdles'],
  ['100 Hurdles', '100m hurdles', 100, 'time', 'Sprints and hurdles'],
  ['200 Meters', '200m', 200, 'time', 'Sprints and hurdles'],
  ['400 Meters', '400m', 400, 'time', 'Sprints and hurdles'],
  ['400 Hurdles', '400m hurdles', 400, 'time', 'Sprints and hurdles'],
  ['800 Meters', '800m', 800, 'time', 'Distance'],
  ['1500 Meters', '1500m', 1500, 'time', 'Distance'],
  ['3000 Steeplechase', '3000m steeplechase', 3000, 'time', 'Distance'],
  ['3000 Meters Steeplechase', '3000m steeplechase', 3000, 'time', 'Distance'],
  ['5000 Meters', '5000m', 5000, 'time', 'Distance'],
  ['10,000 Meters', '10000m', 10000, 'time', 'Distance'],
  ['10000 Meters', '10000m', 10000, 'time', 'Distance'],
  ['4 x 100 Relay', '4×100m relay', 400, 'time', 'Relays'],
  ['4 x 400 Relay', '4×400m relay', 1600, 'time', 'Relays'],
  ['High Jump', 'High jump', null, 'mark', 'Field and multis'],
  ['Pole Vault', 'Pole vault', null, 'mark', 'Field and multis'],
  ['Long Jump', 'Long jump', null, 'mark', 'Field and multis'],
  ['Triple Jump', 'Triple jump', null, 'mark', 'Field and multis'],
  ['Shot Put', 'Shot put', null, 'mark', 'Field and multis'],
  ['Discus', 'Discus', null, 'mark', 'Field and multis'],
  ['Hammer', 'Hammer', null, 'mark', 'Field and multis'],
  ['Javelin', 'Javelin', null, 'mark', 'Field and multis'],
  ['Weight Throw', 'Weight throw', null, 'mark', 'Field and multis'],
  ['Decathlon', 'Decathlon', null, 'points', 'Field and multis'],
  ['Heptathlon', 'Heptathlon', null, 'points', 'Field and multis'],
]

const BY_NAME = new Map()
const ORDER = { indoor: new Map(), outdoor: new Map() }
INDOOR.forEach((row, index) => {
  const [name, label, dist, kind, group] = row
  BY_NAME.set(name, { label, dist, kind, group })
  ORDER.indoor.set(name, index)
})
OUTDOOR.forEach((row, index) => {
  const [name, label, dist, kind, group] = row
  if (!BY_NAME.has(name)) BY_NAME.set(name, { label, dist, kind, group })
  ORDER.outdoor.set(name, index)
})

export function slugFromLabel(label) {
  return String(label).toLowerCase().replaceAll('×', 'x').replace(/[^a-z0-9]+/g, '-').replace(/-+$/g, '')
}

function inferred(name) {
  const n = name.toLowerCase()
  if (/decathlon|heptathlon|pentathlon/.test(n)) {
    return { label: name, dist: null, kind: 'points', group: 'Field and multis' }
  }
  if (/jump|vault|put|throw|discus|hammer|javelin/.test(n)) {
    return { label: name, dist: null, kind: 'mark', group: 'Field and multis' }
  }
  if (/relay/.test(n)) {
    let dist = null
    if (/4\s*x\s*100/.test(n)) dist = 400
    else if (/4\s*x\s*400/.test(n)) dist = 1600
    else if (/medley/.test(n)) dist = 4000
    return { label: name, dist, kind: 'time', group: 'Relays' }
  }
  const meters = n.match(/(\d[\d,]*)/)
  const dist = meters ? Number(meters[1].replaceAll(',', '')) : null
  const group = dist != null && dist <= 400 ? 'Sprints and hurdles' : 'Distance'
  return { label: name, dist: Number.isFinite(dist) ? dist : null, kind: 'time', group }
}

export function eventMeta(name) {
  return BY_NAME.get(name) || inferred(name)
}

// Races, jumps and throws have a strip; combined events score points, which have no distance to show.
export function hasStrip(meta) {
  if (meta.kind === 'mark') return true
  return meta.kind === 'time' && Number.isFinite(meta.dist) && meta.dist > 0
}

export function compareEvents(a, b, season = 'indoor') {
  const group = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
  if (group) return group
  const map = ORDER[season] || ORDER.indoor
  const ia = map.has(a.name) ? map.get(a.name) : 1000
  const ib = map.has(b.name) ? map.get(b.name) : 1000
  return ia - ib || a.name.localeCompare(b.name)
}
