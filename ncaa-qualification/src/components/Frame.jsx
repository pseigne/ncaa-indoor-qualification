import { useEffect, useLayoutEffect, useRef } from 'react'
import { accessibleConversion, FOOTNOTE, formatBare, formatMark, shortDate } from '../utils/format'
import { grouped } from '../utils/model'
import { endYear, href, listLink, plainClick, yearLabel } from '../utils/route'
import { focusHeading, trapTab } from '../utils/focus'
import { useMedia } from '../utils/media'
import { Mark } from './Mark'

export const SITE_TITLE = 'NCAA TF Qualification Monitor'
export const SITE_SHORT = 'NCAA TF Qualification Monitor'

const CHEVRON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

const BURGER = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

const CROSS = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

// The nav holds the site's name and the year, and on phones the menu button. Gender and season sit over the event list.
export function Header({ query, go, years = [], year = null, wide = false, menu = false, menuOpen = false, onMenu }) {
  const ref = useRef(null)
  // The link is named by whichever title is showing, so the name always holds the visible words.
  const short = useMedia('(max-width: 960px)')
  // The header is pinned, so the sidebar, the rail and the column heads need its height. It is
  // watched rather than read once: the first read can come before the header has its final size.
  useLayoutEffect(() => {
    const root = document.documentElement
    const measure = () => root.style.setProperty('--head', `${ref.current?.offsetHeight || 66}px`)
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (ref.current) observer?.observe(ref.current)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [])
  return (
    <header className={`top${wide ? ' event' : ''}`} ref={ref}>
      <a className="mark press" href={href({ ...query, view: 'event' })} onClick={event => { if (plainClick(event)) go(event.currentTarget.href, event) }}>
        <img className="mark-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width="32" height="32" />
        <span className="mark-full" aria-hidden={short ? 'true' : undefined}>{SITE_TITLE}</span>
        <span className="mark-short" aria-hidden={short ? undefined : 'true'}>{SITE_SHORT}</span>
      </a>
      <div className="top-end">
        {year && <YearMenu query={query} go={go} years={years} year={year} />}
        {menu && (
          <button
            type="button"
            className="burger press"
            aria-label="Menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen ? 'true' : 'false'}
            onClick={onMenu}
          >
            {BURGER}
          </button>
        )}
      </div>
    </header>
  )
}

// A native menu: the platform's own picker on phones, and the keyboard works as everywhere else.
function YearMenu({ query, go, years, year, keep = false }) {
  const latest = years[0]
  const choose = change => {
    const key = change.target.value
    go(href({ ...query, year: key === latest ? '' : endYear(key), day: '' }), null, { keep })
  }
  return (
    <label className="yearpick">
      <span className="vh">{query.season === 'indoor' ? 'Indoor season' : 'Outdoor season'}</span>
      <select value={year} onChange={choose} disabled={years.length < 2}>
        {years.map(key => <option key={key} value={key}>{yearLabel(key)}</option>)}
      </select>
      {CHEVRON}
    </label>
  )
}

// A line at the foot of every page.
export function Footer() {
  return (
    <footer className="foot">
      <p>Not affiliated with the NCAA.</p>
    </footer>
  )
}

function filterLink(query, go, next, label, keep = false) {
  return (
    <a
      className="press"
      href={href(next)}
      aria-current={sameSelection(query, next) ? 'page' : undefined}
      onClick={event => { if (plainClick(event)) go(event.currentTarget.href, event, { keep }) }}
    >{label}</a>
  )
}

// Men or women, indoor or outdoor, and the outdoor region: above the event list and on the board.
export function Filters({ query, go }) {
  const link = (next, label) => filterLink(query, go, next, label)
  return (
    <nav className="filters" aria-label="Season and gender">
      <span className="grp">
        {link({ ...query, gender: 'm' }, 'Men')}
        {link({ ...query, gender: 'f' }, 'Women')}
      </span>
      <span className="grp">
        {link({ ...query, season: 'indoor' }, 'Indoor')}
        {link({ ...query, season: 'outdoor' }, 'Outdoor')}
      </span>
      {query.season === 'outdoor' && (
        <span className="grp">
          {link({ ...query, region: 'East' }, 'East')}
          {link({ ...query, region: 'West' }, 'West')}
        </span>
      )}
    </nav>
  )
}

// On phones: men or women, and outdoors the region, a thumb's reach from the event. They keep the event,
// and the lists they lead to have loaded behind the page, so switching is instant.
export function Switches({ query, go }) {
  const link = (next, label) => filterLink(query, go, next, label)
  const outdoor = query.season === 'outdoor'
  return (
    <nav className="filters quick" aria-label={outdoor ? 'Gender and region' : 'Gender'}>
      <span className="grp">
        {link({ ...query, gender: 'm' }, 'Men')}
        {link({ ...query, gender: 'f' }, 'Women')}
      </span>
      {outdoor && (
        <span className="grp">
          {link({ ...query, region: 'East' }, 'East')}
          {link({ ...query, region: 'West' }, 'West')}
        </span>
      )}
    </nav>
  )
}

function sameSelection(query, next) {
  return query.gender === next.gender && query.season === next.season && (next.season !== 'outdoor' || query.region === next.region)
}

export function Index({ events, query, current, go }) {
  return (
    <aside className="index">
      <Filters query={query} go={go} />
      <nav className="events" aria-label="Events">
        {grouped(events).map(group => (
          <div key={group.name}>
            <h2>{group.name}</h2>
            {group.events.map(event => (
              <a
                key={event.slug}
                className="press"
                href={href({ ...query, view: 'event', event: event.slug })}
                aria-current={event === current ? 'page' : undefined}
                aria-label={lineName(event)}
                onClick={click => { if (plainClick(click)) go(click.currentTarget.href, click) }}
              >
                <span>{event.label}</span>{' '}
                <span>{event.line ? <Mark text={formatMark(event.line.v, event.kind)} conversion={event.line.conversion} interactive={false} hang /> : '—'}</span>
              </a>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

// The menu: the season and its year, then every event with its line. Full screen on phones, a panel
// from the right on the narrow split. A season or year keeps it open, so an event can be picked next;
// an event or the board closes it.
export function Menu({ open, onClose, events, query, current = null, go, years = [], year = null }) {
  const ref = useRef(null)
  const shown = useRef(false)
  // Where focus goes back to: the button that opened it, unless a choice has opened a new page.
  const opener = useRef(null)
  const chose = useRef(false)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return undefined
    if (open && !dialog.open) {
      opener.current = document.activeElement
      chose.current = false
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      // The season stays at the top; the current event is brought up only when it is out of sight.
      dialog.querySelector('.menu-body')?.scrollTo?.(0, 0)
      dialog.querySelector('.events [aria-current]')?.scrollIntoView?.({ block: 'nearest' })
      if (!dialog.contains(document.activeElement)) dialog.querySelector('.close')?.focus()
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
    if (!open && shown.current) {
      const back = opener.current
      // Safari doesn't focus a button on click, so the opener may be the page itself.
      if (!chose.current && back?.isConnected && back !== document.body) back.focus()
      else focusHeading()
    }
    shown.current = open
    return undefined
  }, [open])
  const onKeyDown = key => {
    if (key.key === 'Escape') {
      key.preventDefault()
      onClose()
      return
    }
    trapTab(key, ref.current)
  }
  const choose = event => {
    if (!plainClick(event)) return
    chose.current = true
    go(event.currentTarget.href, event)
    onClose()
  }
  const board = query.view === 'board'
  return (
    <dialog ref={ref} className="menu" aria-label="Menu" onClose={onClose} onCancel={cancel => { cancel.preventDefault(); onClose() }} onKeyDown={onKeyDown}>
      <div className="menu-top">
        <span className="mark" aria-hidden="true">
          <img className="mark-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width="32" height="32" />
          <span>{SITE_SHORT}</span>
        </span>
        <button type="button" className="press close" aria-label="Close" onClick={onClose}>{CROSS}</button>
      </div>
      <div className="menu-body">
        <div className="menu-season">
          <nav className="filters" aria-label="Season">
            <span className="grp">
              {filterLink(query, go, { ...query, season: 'indoor' }, 'Indoor', true)}
              {filterLink(query, go, { ...query, season: 'outdoor' }, 'Outdoor', true)}
            </span>
          </nav>
          {year && <YearMenu query={query} go={go} years={years} year={year} keep />}
        </div>
        <a className="press board-link" href={href({ ...query, view: 'board', event: '' })} aria-current={board ? 'page' : undefined} onClick={choose}>
          Every qualifying line
        </a>
        <p className="menu-who">{query.gender === 'f' ? 'Women’s' : 'Men’s'} lines{query.season === 'outdoor' ? `, ${query.region}` : ''}</p>
        {events ? (
          <nav className="events" aria-label="Events">
            {grouped(events).map(group => (
              <div key={group.name}>
                <h2>{group.name}</h2>
                {group.events.map(event => (
                  <a
                    key={event.slug}
                    className="press"
                    href={href({ ...query, view: 'event', event: event.slug })}
                    aria-current={!board && event === current ? 'page' : undefined}
                    aria-label={lineName(event, formatBare)}
                    onClick={choose}
                  >
                    <span>{event.label}</span>{' '}
                    <span>{event.line ? <Mark text={formatBare(event.line.v, event.kind)} conversion={event.line.conversion} interactive={false} hang /> : '—'}</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
        ) : <p className="menu-wait">Loading the events…</p>}
        <p className="menu-foot">Not affiliated with the NCAA.</p>
      </div>
    </dialog>
  )
}

// Starts with the words on the link, the event and its line, then any conversion note.
function lineName(event, format = formatMark) {
  if (!event.line) return event.label
  const phrase = accessibleConversion(event.line.conversion)
  const mark = `${event.label}, ${format(event.line.v, event.kind)}`
  return phrase ? `${mark}, ${phrase}` : mark
}

export function Source({ season, year, region, listDate, final, extra, board = false, query, go, after = null, footnote = false, list = null }) {
  const link = list || listLink(season, year, region)
  const when = listDate ? `${shortDate(listDate)}, ${listDate.slice(0, 4)}` : null
  const lead = when ? `${final ? 'Final list' : 'Latest list'} from TFRRS, ${when}` : `${final ? 'Final list' : 'List'} from TFRRS`
  return (
    <p className="source">
      {lead}{link ? <> · <a href={link.href}>{link.title}</a></> : null}.
      {footnote ? <> {FOOTNOTE}</> : null}
      {extra ? <> {extra}</> : null}
      {board ? null : (
        <>
          {' '}
          <a href={href({ ...query, view: 'board', event: '' })} onClick={event => { if (plainClick(event)) go(event.currentTarget.href, event) }}>Every qualifying line</a>.
        </>
      )}
      {after}
    </p>
  )
}
