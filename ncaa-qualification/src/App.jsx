import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BoardView from './components/BoardView'
import EventView from './components/EventView'
import NationalsDetail from './components/NationalsDetail'
import { Footer, Header, Index, Menu, SITE_TITLE, Switches } from './components/Frame'
import { focusHeading } from './utils/focus'
import DetailSheet from './components/DetailSheet'
import PastYears from './components/PastYears'
import SeasonDetail from './components/SeasonView'
import { useCompact, usePhone } from './utils/media'
import { activeYear, buildEvents, historyFile, listContext, listEntry, pastList, seasonYears } from './utils/model'
import { nationalsEntries, nationalsEvent, readNationals } from './utils/nationals'
import { pastLines } from './utils/past'
import { detailHref, endYear, plainClick, readQuery, yearLabel } from './utils/route'

function pickEvent(events, slug, season) {
  return events.find(event => event.slug === slug)
    || events.find(event => event.slug === (season === 'outdoor' ? '1500m' : 'mile'))
    || events[0]
    || null
}

// A data file, or false when it's missing or not what the site expects.
function fetchFile(name) {
  return fetch(`${import.meta.env.BASE_URL}data/${name}`)
    .then(res => {
      if (!res.ok) throw new Error('missing')
      return res.json()
    })
    .then(json => [name, usable(name, json) ? json : false], () => [name, false])
}

function usable(name, json) {
  if (name === 'index.json') return Array.isArray(json?.lists)
  if (name.startsWith('history-')) return Array.isArray(json?.lines)
  if (name.startsWith('nationals-')) return readNationals(json) !== null
  return Array.isArray(json?.events)
}

const NO_HISTORY = { lines: [] }

export default function App() {
  const phone = usePhone()
  const compact = useCompact()
  const [search, setSearch] = useState(() => window.location.search)
  // Loaded data files by name: index.json, which lists every saved season, then each list and each
  // season's past cutoffs as they're shown. False marks a file that failed to load.
  const [files, setFiles] = useState({})
  const [retrying, setRetrying] = useState(false)
  const [picker, setPicker] = useState(false)
  const query = useMemo(() => readQuery(search), [search])
  // True when this page opened the dialog, so closing it can step back instead of adding history.
  const openedHere = useRef(false)
  const requested = useRef(new Set())

  // Each file is asked for once; a failed one only again on Try again.
  const request = useCallback(names => {
    const fresh = names.filter(name => !requested.current.has(name))
    fresh.forEach(name => requested.current.add(name))
    if (!fresh.length) return Promise.resolve()
    return Promise.all(fresh.map(fetchFile)).then(results => {
      results.forEach(([name, json]) => { if (json === false) requested.current.delete(name) })
      setFiles(previous => ({ ...previous, ...Object.fromEntries(results) }))
    })
  }, [])

  // The old season page now opens the season dialog over the event page.
  useEffect(() => {
    if (!query.legacy) return
    const next = detailHref(query, 'season')
    window.history.replaceState(null, '', `${window.location.pathname}${next}`)
  }, [query])

  useEffect(() => {
    const onPop = () => setSearch(window.location.search)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // A choice closes the menu, except a season or year picked inside it.
  const go = (url, event, { keep = false } = {}) => {
    if (event) {
      if (!plainClick(event)) return
      event.preventDefault()
    }
    const next = new URL(url, window.location.href)
    openedHere.current = Boolean(next.searchParams.get('detail')) && !query.detail
    window.history.pushState(null, '', `${next.pathname}${next.search}`)
    setSearch(next.search)
    if (!keep) setPicker(false)
  }

  const index = files['index.json'] || null
  const currentYear = activeYear(index, query.season, query.gender)
  const years = useMemo(() => seasonYears(index, query.season, query.gender), [index, query.season, query.gender])
  // A year asked for in the link; one with no saved list falls back to the latest.
  const wanted = query.year ? years.find(key => endYear(key) === query.year) : null
  const year = wanted || currentYear
  const past = Boolean(year && year !== currentYear)

  // A year with no saved list for this season, such as one switched to from the other season, leaves
  // the link, so the link always names the season shown.
  const stale = Boolean(index && query.year && !wanted)
  useEffect(() => {
    if (!stale) return
    const next = new URL(window.location.href)
    next.searchParams.delete('y')
    window.history.replaceState(null, '', `${next.pathname}${next.search}`)
  }, [stale])
  // What the page's links carry: without that year, so they don't bring it back.
  const shown = useMemo(() => (stale ? { ...query, year: '' } : query), [stale, query])

  const entry = index && year ? listEntry(index, { ...query, year }) : null
  const historyName = historyFile(index, query)
  const scope = entry ? files[entry.file] : null
  // Past cutoffs that fail to load leave the page without them, as when there are none.
  const history = historyName ? files[historyName] : NO_HISTORY
  const pastData = history || NO_HISTORY
  // An outdoor regional page shows how its First Round did at nationals, when that year's meet is
  // imported. The national meet's years start in 2018, before most saved lists.
  const meets = useMemo(() => nationalsEntries(index, query.gender), [index, query.gender])
  const onward = query.view === 'event' && query.season === 'outdoor' && year
    ? meets.find(item => item.year === endYear(year)) || null
    : null
  const onwardFile = onward ? files[onward.file] || null : null
  const needed = ['index.json', entry?.file, historyName, onward?.file].filter(name => name && files[name] === undefined)
  const missing = needed.join(' ')
  useEffect(() => {
    if (missing) request(missing.split(' '))
  }, [missing, request])

  const model = useMemo(() => {
    if (!index || !year) return null
    // A season, gender and region with no list shows an empty one.
    if (!entry) return { events: [], context: { championship: null, listDate: null, final: false, year, days: null } }
    if (!scope || history === undefined) return null
    const events = buildEvents(scope)
    // A past season's list is its final one; it has no saved days and links to its own TFRRS list.
    const context = past
      ? { championship: null, listDate: null, final: true, past: true, list: pastList(entry) }
      : listContext(scope)
    return { events, context: { ...context, year, days: entry.days } }
  }, [index, year, entry, scope, history, past])

  // Once the page has its list, the lists one tap away load behind it: the same season for the other
  // gender, and outdoors the other region. Switching to them is then instant.
  const ready = Boolean(model)
  const { season, gender } = query
  useEffect(() => {
    if (!ready || !index || !year) return
    const near = index.lists.filter(item => item.season === season && item.year === year)
    request([
      ...near.map(item => item.file),
      historyFile(index, { season, gender: gender === 'm' ? 'f' : 'm' }),
    ].filter(Boolean))
  }, [ready, index, year, season, gender, request])

  const failed = files['index.json'] === false || scope === false
  const loading = !model && !failed && !(index && !year)
  const status = retrying || (loading && !past)
    ? 'Loading the qualifying lists…'
    : failed ? 'The qualifying lists could not be loaded.'
      : loading ? `Loading the ${yearLabel(year)} lists…` : null
  // After a retry loads the lists, the Try again button is gone: focus goes to the page's heading.
  const retried = useRef(false)
  const retry = () => {
    if (retrying) return
    retried.current = true
    setRetrying(true)
    request(Object.keys(files).filter(name => files[name] === false)).then(() => setRetrying(false))
  }

  useEffect(() => {
    if (!model || !retried.current) return
    retried.current = false
    focusHeading()
  }, [model])

  const event = model ? pickEvent(model.events, query.event, query.season) : null
  // This event at nationals, for its dialog: shown once the meet has loaded, and only when it has the event.
  const atNationals = useMemo(() => (event && onwardFile ? nationalsEvent(onwardFile, event.name) : null), [event, onwardFile])

  const closeDetail = () => {
    if (openedHere.current) {
      openedHere.current = false
      window.history.back()
      return
    }
    const next = detailHref(shown, '')
    window.history.replaceState(null, '', `${window.location.pathname}${next}`)
    setSearch(next)
  }

  useEffect(() => {
    if (!event) {
      document.title = SITE_TITLE
      return
    }
    if (query.view === 'board') document.title = `Every qualifying line · ${SITE_TITLE}`
    else if (query.detail) document.title = `${capital(detailTitle(event, query))} · ${SITE_TITLE}`
    else document.title = `${capital(eventTitleText(event, query))} · ${SITE_TITLE}`
  }, [event, query])

  const wide = query.view === 'event'
  const listed = model && (query.view === 'board' || (query.view === 'event' && event))
  return (
    <>
      {listed && <a className="skip" href="#list" onClick={skipToList}>Skip to the list</a>}
      <Header
        query={shown}
        go={go}
        years={years}
        year={year || currentYear}
        wide={wide}
        menu={compact}
        menuOpen={picker}
        onMenu={() => setPicker(true)}
      />
      <div className={`wrap${wide ? ' event' : ''}`} style={wide ? undefined : { gridTemplateColumns: '1fr' }}>
        {/* the sidebar stays when a choice has no list, so its toggles can always switch back */}
        {wide && <Index events={model?.events || []} query={shown} current={event} go={go} />}
        <main id="main">
          {compact && <Switches query={shown} go={go} />}
          {/* one live region for loading and failure, so each change is announced once; the button stays
              outside it, and stays put while a retry loads so focus is not dropped */}
          {status && <p className="dek" role="status">{status}</p>}
          {(failed || retrying) && (
            <button
              type="button"
              className="more press"
              aria-disabled={retrying ? 'true' : undefined}
              onClick={retry}
            >
              Try again
            </button>
          )}
          {model && query.view === 'board' && (
            <BoardView
              events={model.events}
              query={shown}
              go={go}
              context={model.context}
              phone={phone}
              compact={compact}
              onOpenPicker={() => setPicker(true)}
            />
          )}
          {model && query.view === 'event' && event && (
            <EventView
              key={`${event.slug}:${query.gender}:${query.season}:${query.region}:${phone}`}
              event={event}
              query={shown}
              go={go}
              context={model.context}
              past={pastData}
              onOpenPicker={() => setPicker(true)}
              footnote={model.events.some(item => item.line?.conversion)}
              nationals={onwardFile}
            />
          )}
          {model && !event && <p className="dek">No events match this list.</p>}
          <Footer />
        </main>
      </div>
      {model && event && query.view === 'event' && query.detail && (query.detail !== 'nationals' || atNationals) && (
        <DetailSheet
          key={query.detail}
          name={query.detail}
          eyebrow={capital(eventTitleText(event, query))}
          title={DETAIL_TITLE[query.detail]}
          onClose={closeDetail}
        >
          {query.detail === 'season' && <SeasonDetail event={event} query={shown} context={model.context} past={pastData} />}
          {query.detail === 'nationals' && <NationalsDetail event={atNationals} data={readNationals(onwardFile)} />}
          {query.detail === 'history' && (
              <PastYears
                lines={pastLines(pastData, { season: query.season, region: query.region, gender: query.gender, event: event.name })}
                kind={event.kind}
                currentYear={model.context.year}
                selected={model.context.past ? yearLabel(model.context.year) : null}
              />
          )}
        </DetailSheet>
      )}
      {/* stays while a season picked inside it loads, with its events to follow */}
      {compact && (
        <Menu
          open={picker}
          onClose={() => setPicker(false)}
          events={model ? model.events : null}
          current={event}
          query={shown}
          go={go}
          years={years}
          year={year || currentYear}
        />
      )}
    </>
  )
}

// Lands on the rows' tab stop when the table has one, so the arrows work straight away.
function skipToList(click) {
  const list = document.getElementById('list')
  if (!list) return
  click.preventDefault()
  const row = list.querySelector('tbody tr[tabindex="0"]')
  const target = row || list
  target.focus({ preventScroll: true })
  target.scrollIntoView?.({ block: row ? 'center' : 'start' })
}

function capital(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const DETAIL_TITLE = { season: 'This season', history: 'Past years', nationals: 'Nationals' }

function detailTitle(event, query) {
  if (query.detail === 'nationals') return `${eventTitleText(event, query)} at nationals`
  return `${eventTitleText(event, query)} cutoff ${query.detail === 'season' ? 'this season' : 'in past years'}`
}

function eventTitleText(event, query) {
  const who = query.gender === 'f' ? 'women’s' : 'men’s'
  const region = query.season === 'outdoor' ? `, ${query.region}` : ''
  return `${who} ${event.label.toLowerCase()}${region}`
}
