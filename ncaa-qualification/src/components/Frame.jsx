import { useEffect, useLayoutEffect, useRef } from 'react'
import { accessibleConversion, FOOTNOTE, formatBare, formatMark, shortDate } from '../utils/format'
import { grouped } from '../utils/model'
import { endYear, href, listLink, plainClick, yearLabel } from '../utils/route'
import { focusHeading } from '../utils/focus'
import { useMedia } from '../utils/media'
import { Mark } from './Mark'

export const SITE_TITLE = 'NCAA TF Qualification Monitor'
export const SITE_SHORT = 'NCAA TF Qualification Monitor'

const CHEVRON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

// The nav holds the site's name and the year. Gender and season sit over the event list.
export function Header({ query, go, years = [], year = null, wide = false }) {
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
        <img className="mark-logo" src={`${import.meta.env.BASE_URL}ncaa-tf.png`} alt="" width="32" height="40" />
        <span className="mark-full" aria-hidden={short ? 'true' : undefined}>{SITE_TITLE}</span>
        <span className="mark-short" aria-hidden={short ? undefined : 'true'}>{SITE_SHORT}</span>
      </a>
      {year && <YearMenu query={query} go={go} years={years} year={year} />}
    </header>
  )
}

// A native menu: the platform's own picker on phones, and the keyboard works as everywhere else.
function YearMenu({ query, go, years, year }) {
  const latest = years[0]
  const choose = change => {
    const key = change.target.value
    go(href({ ...query, year: key === latest ? '' : endYear(key), day: '' }))
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

// Men or women, indoor or outdoor, and the outdoor region: above the event list, on the board, and in
// the picker on phones.
// A line at the foot of every page.
export function Footer() {
  return (
    <footer className="foot">
      <p>Not affiliated with the NCAA.</p>
    </footer>
  )
}

export function Filters({ query, go, onChoose }) {
  const link = (next, label) => (
    <a
      className="press"
      href={href(next)}
      aria-current={sameSelection(query, next) ? 'page' : undefined}
      onClick={event => {
        if (!plainClick(event)) return
        go(event.currentTarget.href, event)
        onChoose?.()
      }}
    >{label}</a>
  )
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

export function Picker({ open, onClose, events, query, go }) {
  const ref = useRef(null)
  const shown = useRef(false)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return undefined
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      if (!dialog.contains(document.activeElement)) dialog.querySelector('.close')?.focus()
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
    // Closed by a choice, Escape or Close: focus goes back to the picker button, which a choice may have
    // replaced with a new page's, or to the new page's heading when that page has no picker.
    if (!open && shown.current) focusHeading()
    shown.current = open
    return undefined
  }, [open])
  // Escape always closes through onClose, and Tab wraps inside the sheet while it is open.
  const onKeyDown = key => {
    if (key.key === 'Escape') {
      key.preventDefault()
      onClose()
      return
    }
    if (key.key !== 'Tab') return
    const stops = [...ref.current.querySelectorAll('a[href], button')]
    if (!stops.length) return
    const first = stops[0]
    const last = stops.at(-1)
    if (key.shiftKey && document.activeElement === first) {
      key.preventDefault()
      last.focus()
    } else if (!key.shiftKey && document.activeElement === last) {
      key.preventDefault()
      first.focus()
    }
  }
  const choose = event => {
    if (!plainClick(event)) return
    go(event.currentTarget.href, event)
    onClose()
  }
  const choice = (next, label) => (
    <a href={href(next)} aria-current={sameSelection(query, next) ? 'page' : undefined} onClick={choose}>{label}</a>
  )
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onCancel={cancel => { cancel.preventDefault(); onClose() }} onKeyDown={onKeyDown}>
      <button type="button" className="press close" onClick={onClose}>Close</button>
      <h2>List</h2>
      <div className="seg">
        {choice({ ...query, gender: 'm' }, 'Men')}
        {choice({ ...query, gender: 'f' }, 'Women')}
        <span className="sep" aria-hidden="true" />
        {choice({ ...query, season: 'indoor' }, 'Indoor')}
        {choice({ ...query, season: 'outdoor' }, 'Outdoor')}
        {query.season === 'outdoor' && (
          <>
            <span className="sep" aria-hidden="true" />
            <a href={href({ ...query, region: 'East' })} aria-current={query.region === 'East' ? 'page' : undefined} onClick={choose}>East</a>
            <a href={href({ ...query, region: 'West' })} aria-current={query.region === 'West' ? 'page' : undefined} onClick={choose}>West</a>
          </>
        )}
      </div>
      <a className="press board-link" href={href({ ...query, view: 'board', event: '' })} onClick={choose}>Every qualifying line</a>
      <div className="events">
        {grouped(events).map(group => (
          <div key={group.name}>
            <h2>{group.name}</h2>
            {group.events.map(event => (
              <a key={event.slug} className="press" href={href({ ...query, view: 'event', event: event.slug })} aria-label={lineName(event, formatBare)} onClick={choose}>
                <span>{event.label}</span>{' '}
                <span>{event.line ? <Mark text={formatBare(event.line.v, event.kind)} conversion={event.line.conversion} interactive={false} hang /> : '—'}</span>
              </a>
            ))}
          </div>
        ))}
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
