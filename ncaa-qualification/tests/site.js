import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { vi } from 'vitest'

const SITE = join(process.cwd(), '../data/site')

// One published site file, as tfrrs_data.py writes it.
export function savedFile(name) {
  return JSON.parse(readFileSync(join(SITE, name), 'utf8'))
}

// Every published site file, by name.
export function savedSite() {
  return Object.fromEntries(readdirSync(SITE).filter(name => name.endsWith('.json')).map(name => [name, savedFile(name)]))
}

// Site files for test lists, shaped as tfrrs_data.py writes them: one file per season, year, gender
// and region, and index.json listing them. A season's latest year is its current one.
//
// Each record is one event's list: { year, season, region, gender, event, rankings, qualification },
// plus `series`, its chart's saved days as [[date, mark, marks]], and `afterMeet` when it was saved after
// the championship began. `scope` sets every list's championship, listDate and final; `days` is each
// list's saved days for the season dialog's race; `past` is the past cutoffs.
export function siteFiles(records, { scope = {}, days = null, past = { lines: [] } } = {}) {
  const groups = new Map()
  for (const record of records) {
    const name = `${record.season}-${record.year}-${record.gender}-${record.region}.json`
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(record)
  }
  const latest = {}
  for (const record of records) {
    const key = `${record.season}-${record.gender}`
    if (!latest[key] || record.year > latest[key]) latest[key] = record.year
  }
  const files = {}
  const lists = []
  for (const [name, group] of groups) {
    const { season, year, gender, region } = group[0]
    files[name] = {
      season, year, gender, region, championship: null, listDate: null, final: false, ...scope,
      events: group.map(record => ({
        event: record.event,
        qualification: record.qualification,
        rankings: record.rankings,
        series: record.series || [],
        afterMeet: record.afterMeet === true,
      })),
    }
    if (days) files[`days-${name}`] = days
    lists.push({
      season, year, gender, region, current: latest[`${season}-${gender}`] === year, file: name,
      days: days ? `days-${name}` : null, source: { list_id: '1', list_name: 'List' },
    })
  }
  const history = {}
  for (const season of ['indoor', 'outdoor']) {
    for (const gender of ['m', 'f']) {
      const name = `history-${season}-${gender}.json`
      history[`${season}-${gender}`] = name
      files[name] = { lines: past.lines.filter(line => line.season === season && line.gender === gender) }
    }
  }
  files['index.json'] = { lists, history }
  return files
}

function missing() {
  return { ok: false, status: 404, json: async () => { throw new SyntaxError('not json') } }
}

// Serves site files to the app. `fail(name)` returns '404' or 'network' to make a file fail to load.
export function serveSite(files, { logos = null, fail = () => null } = {}) {
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url.includes('team-logos/index.json')) return logos ? { ok: true, json: async () => logos } : missing()
    const name = decodeURIComponent(url.split('/data/').at(-1))
    const failure = fail(name)
    if (failure === 'network') throw new TypeError('Failed to fetch')
    if (failure) return missing()
    return name in files ? { ok: true, json: async () => files[name] } : missing()
  }))
}

// The site files the app asked for, by name.
export function fetched() {
  return fetch.mock.calls.map(([url]) => decodeURIComponent(url.split('/data/').at(-1)))
}
