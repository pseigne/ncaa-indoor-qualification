import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BoardView from './components/BoardView'
import EventView from './components/EventView'
import { Header, Index, Picker, SITE_TITLE } from './components/Frame'
import { focusHeading } from './utils/focus'
import DetailSheet from './components/DetailSheet'
import NationalsView from './components/NationalsView'
import PastYears from './components/PastYears'
import SeasonDetail from './components/SeasonView'
import { useCompact, usePhone } from './utils/media'
import { activeYear, buildEvents, historyFile, listContext, listEntry, pastList, seasonYears } from './utils/model'
import { nationalsEntries, nationalsEvents, nationalsTitle, NationalsOffered, pickNational, readNationals } from './utils/nationals'
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

  const go = (url, event) => {
    if (event) {
      if (!plainClick(event)) return
      event.preventDefault()
    }
    const next = new URL(url, window.location.href)
    openedHere.current = Boolean(next.searchParams.get('detail')) && !query.detail
    window.history.pushState(null, '', `${next.pathname}${next.search}`)
    setSearch(next.search)
    setPicker(false)
  }

  const index = files['index.json'] || null
  const currentYear = activeYear(index, query.season, query.gender)
  const years = useMemo(() => seasonYears(index, query.season, query.gender), [index, query.season, query.gender])
  // A year asked for in the link; one with no saved list falls back to the latest.
  const wanted = query.year ? years.find(key => endYear(key) === query.year) : null
  const year = wanted || currentYear
  const past = Boolean(year && year !== currentYear)

  // The national meet has its own years, from 2018, most of them before the saved lists. Asked for
  // where index.json lists none, for this gender or at all, the event page shows instead.
  const meets = useMemo(() => nationalsEntries(index, query.gender), [index, query.gender])
  const asked = query.view === 'nationals'
  const view = asked ? (!index || meets.length ? 'nationals' : 'event') : query.view
  const nationals = view === 'nationals'
  const meetWanted = query.year ? meets.find(item => item.year === query.year) : null
  const meet = nationals ? meetWanted || meets[0] || null : null

  // A year with no saved list for this season, such as one switched to from the other season, leaves
  // the link, so the link always names the season shown. So does a national meet there's none of.
  const stale = Boolean(index && query.year && !(nationals ? meetWanted : wanted))
  const unoffered = Boolean(index && asked && !nationals)
  useEffect(() => {
    if (!stale && !unoffered) return
    const next = new URL(window.location.href)
    if (stale) next.searchParams.delete('y')
    if (unoffered) next.searchParams.delete('view')
    window.history.replaceState(null, '', `${next.pathname}${next.search}`)
  }, [stale, unoffered])
  // What the page's links carry: without that year, so they don't bring it back.
  const shown = useMemo(() => ({ ...query, view, year: stale ? '' : query.year }), [stale, query, view])

  // The national meet needs only its own file; the lists wait until a region is picked.
  const entry = index && year && !nationals ? listEntry(index, { ...query, year }) : null
  const historyName = nationals ? null : historyFile(index, query)
  const scope = entry ? files[entry.file] : null
  // Past cutoffs that fail to load leave the page without them, as when there are none.
  const history = historyName ? files[historyName] : NO_HISTORY
  const pastData = history || NO_HISTORY
  const needed = ['index.json', entry?.file, historyName, meet?.file].filter(name => name && files[name] === undefined)
  const missing = needed.join(' ')
  useEffect(() => {
    if (missing) request(missing.split(' '))
  }, [missing, request])

  const meetFile = meet ? files[meet.file] : null
  const meetData = useMemo(() => (meetFile ? readNationals(meetFile) : null), [meetFile])
  const meetEvents = useMemo(() => (meetData ? nationalsEvents(meetData) : null), [meetData])

  const model = useMemo(() => {
    if (nationals || !index || !year) return null
    // A season, gender and region with no list shows an empty one.
    if (!entry) return { events: [], context: { championship: null, listDate: null, final: false, year, days: null } }
    if (!scope || history === undefined) return null
    const events = buildEvents(scope)
    // A past season's list is its final one; it has no saved days and links to its own TFRRS list.
    const context = past
      ? { championship: null, listDate: null, final: true, past: true, list: pastList(entry) }
      : listContext(scope)
    return { events, context: { ...context, year, days: entry.days } }
  }, [nationals, index, year, entry, scope, history, past])

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

  const failed = files['index.json'] === false || (nationals ? meetFile === false : scope === false)
  const loading = !model && !failed && !(index && !year)
  const status = nationals
    ? (retrying || (!meetEvents && !failed) ? 'Loading the nationals results…' : failed ? 'The nationals results could not be loaded.' : null)
    : retrying || (loading && !past)
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

  const shownPage = model || meetEvents
  useEffect(() => {
    if (!shownPage || !retried.current) return
    retried.current = false
    focusHeading()
  }, [shownPage])

  const event = model ? pickEvent(model.events, query.event, query.season) : null
  const meetEvent = nationals && meetEvents ? pickNational(meetEvents, query.event) : null

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
    if (meetEvent) {
      document.title = `${capital(nationalsTitle(meetEvent, query.gender))}, ${meetData.year} · ${SITE_TITLE}`
      return
    }
    if (!event) {
      document.title = SITE_TITLE
      return
    }
    if (view === 'board') document.title = `Every qualifying line · ${SITE_TITLE}`
    else if (query.detail) document.title = `${capital(detailTitle(event, query))} · ${SITE_TITLE}`
    else document.title = `${capital(eventTitleText(event, query))} · ${SITE_TITLE}`
  }, [event, meetEvent, meetData, query, view])

  const wide = view === 'event' || nationals
  const listed = (model && (view === 'board' || (view === 'event' && event))) || Boolean(meetEvent)
  const menuYears = nationals ? meets.map(item => item.year) : years
  const menuYear = nationals ? meet?.year || null : year || currentYear
  const pickable = nationals ? meetEvents : model?.events
  return (
    <NationalsOffered.Provider value={meets.length > 0}>
      {listed && <a className="skip" href="#list" onClick={skipToList}>Skip to the list</a>}
      <Header query={shown} go={go} years={menuYears} year={menuYear} wide={wide} />
      <div className={`wrap${wide ? ' event' : ''}`} style={wide ? undefined : { gridTemplateColumns: '1fr' }}>
        {/* the sidebar stays when a choice has no list, so its toggles can always switch back */}
        {wide && <Index events={pickable || []} query={shown} current={nationals ? meetEvent : event} go={go} />}
        <main id="main">
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
          {model && view === 'board' && (
            <BoardView
              events={model.events}
              query={shown}
              go={go}
              context={model.context}
              phone={phone}
              onOpenPicker={() => setPicker(true)}
            />
          )}
          {model && view === 'event' && event && (
            <EventView
              key={`${event.slug}:${query.gender}:${query.season}:${query.region}:${phone}`}
              event={event}
              query={shown}
              go={go}
              context={model.context}
              past={pastData}
              onOpenPicker={() => setPicker(true)}
              footnote={model.events.some(item => item.line?.conversion)}
            />
          )}
          {meetEvent && (
            <NationalsView
              key={`${meetEvent.slug}:${query.gender}:${meetData.year}`}
              event={meetEvent}
              data={meetData}
              query={shown}
              onOpenPicker={() => setPicker(true)}
            />
          )}
          {((model && !event) || (meetEvents && !meetEvent)) && <p className="dek">No events match this list.</p>}
        </main>
      </div>
      {model && event && view === 'event' && query.detail && (
        <DetailSheet
          key={query.detail}
          name={query.detail}
          eyebrow={capital(eventTitleText(event, query))}
          title={query.detail === 'season' ? 'This season' : 'Past years'}
          onClose={closeDetail}
        >
          {query.detail === 'season'
            ? <SeasonDetail event={event} query={shown} context={model.context} past={pastData} />
            : (
              <PastYears
                lines={pastLines(pastData, { season: query.season, region: query.region, gender: query.gender, event: event.name })}
                kind={event.kind}
                currentYear={model.context.year}
                selected={model.context.past ? yearLabel(model.context.year) : null}
              />
            )}
        </DetailSheet>
      )}
      {compact && pickable && (
        <Picker open={picker} onClose={() => setPicker(false)} events={pickable} query={shown} go={go} />
      )}
    </NationalsOffered.Provider>
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

function detailTitle(event, query) {
  return `${eventTitleText(event, query)} cutoff ${query.detail === 'season' ? 'this season' : 'in past years'}`
}

function eventTitleText(event, query) {
  const who = query.gender === 'f' ? 'women’s' : 'men’s'
  const region = query.season === 'outdoor' ? `, ${query.region}` : ''
  return `${who} ${event.label.toLowerCase()}${region}`
}
