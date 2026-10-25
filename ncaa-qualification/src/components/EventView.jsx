import { useEffect, useMemo, useRef, useState } from 'react'
import { finitePoints } from '../utils/chart'
import {
  accessibleConversion, eventTitle, formatBare, formatGap, formatMark, gapToLine, longDate, ordinal, shortDate, surname, tidy, unitWord,
} from '../utils/format'
import {
  canvasMeasure, formatMeters, metersAhead, layoutColumn, layoutStrip,
} from '../utils/strip'
import { comparisonSeries, pickComparison } from '../utils/comparison'
import { detailHref, plainClick, yearLabel } from '../utils/route'
import { pastLines, pastSummary } from '../utils/past'
import {
  useCompact, useMedia, usePhone, useReduceMotion, useSplit, useWidth,
} from '../utils/media'
import { freeTop, nearestRow, readingLine } from '../utils/active'
import RaceColumn from './RaceColumn'
import RaceStrip from './RaceStrip'
import Spark from './Spark'
import { Source } from './Frame'
import { Mark } from './Mark'
import Logo from './Logo'
import { YearSpark } from './PastYears'

const ARROW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

const CHEVRON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export default function EventView({ event, query, go, context, past = null, onOpenPicker, footnote = false }) {
  const phone = usePhone()
  const compact = useCompact()
  const split = useSplit()
  const reduce = useReduceMotion()
  const width = useWidth()
  const pending = useRef(null)
  const finishRef = useRef(null)
  const timer = useRef(null)
  const opened = useRef(false)
  const heroRef = useRef(null)
  const miniRef = useRef(null)
  const stickRef = useRef(null)
  const lineRank = event.line?.rank
  const [from, setFrom] = useState(() => (phone && lineRank ? Math.max(1, lineRank - 4) : 1))
  const [all, setAll] = useState(false)
  const [hover, setHover] = useState(null)
  const [memory, setMemory] = useState(null)
  const [railSize, setRailSize] = useState(null)
  const [seen, setSeen] = useState(null)
  const [pointed, setPointed] = useState(null)
  const [measure, setMeasure] = useState(() => canvasMeasure())
  const [mini, setMini] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [scrollRank, setScrollRank] = useState(null)
  const [cursor, setCursor] = useState(null)
  const bodyRef = useRef(null)
  const noHover = useMedia('(hover: none)')
  const title = eventTitle(event, query.gender, query.season, query.region)
  const points = finitePoints(event.series)
  // Compare with the first saved list from Feb 1 that is longer than the qualifying spot.
  const since = pickComparison(points, { rank: event.line?.rank ?? event.rank, year: context.year })
  const trend = comparisonSeries(points, since)
  const trendSeries = comparisonSeries(event.series, since)
  const opening = trend[0]
  const stripWidth = phone ? Math.max(280, width - 32) : 960
  // The field line is drawn only once every accepted entry is matched to a saved row.
  const field = event.field?.status === 'available' ? event.field : null
  const runners = useMemo(() => event.rows.filter(row => Number.isFinite(row.v)).map(row => ({
    rank: row.rank,
    name: event.isRelay ? (row.team || row.athlete) : row.athlete,
    team: row.team || row.athlete,
    v: row.v,
    conversion: row.conversion,
  })), [event])
  const layout = useMemo(() => {
    if (split || !event.strip || !event.line) return null
    return layoutStrip({
      rows: runners,
      lineV: event.line.v,
      lineConversion: event.line.conversion,
      dist: event.dist,
      rank: event.line.rank,
      width: stripWidth,
      radius: phone ? 4.5 : 8,
      phone,
    })
  }, [event, runners, split, phone, stripWidth])
  const column = useMemo(() => {
    if (!split || !railSize || !event.strip || !event.line) return null
    return layoutColumn({
      rows: runners,
      lineV: event.line.v,
      lineConversion: event.line.conversion,
      dist: event.dist,
      rank: event.line.rank,
      width: railSize.width,
      height: railSize.height,
      bottom: 52,
      minPitch: width >= 1440 ? 16 : 14,
      measure,
    })
  }, [event, runners, split, railSize, measure, width])
  const railed = split && Boolean(event.strip && event.line)
  // Without hover (phones, touch screens with the flat strip) scrolling picks the row instead.
  const scrollLinked = Boolean(layout) && (phone || noHover)

  useEffect(() => {
    if (!phone || !lineRank) return undefined
    let cancel = false
    const ready = document.fonts?.ready || Promise.resolve()
    ready.then(() => {
      requestAnimationFrame(() => {
        if (cancel || opened.current) return
        const fin = finishRef.current
        const sample = document.querySelector('tbody tr[data-rank]')
        if (!fin || !sample) return
        const rowH = sample.getBoundingClientRect().height || 44
        let next = lineRank - 4
        let bottom = fin.getBoundingClientRect().bottom
        while (bottom > window.innerHeight && next < lineRank) {
          bottom -= rowH
          next += 1
        }
        if (next > 1) setFrom(Math.max(1, next))
      })
    })
    return () => { cancel = true }
  }, [phone, event.slug, lineRank, layout])

  useEffect(() => () => clearTimeout(timer.current), [])

  // On phones the strip sticks under the nav. Once the full hero has scrolled up behind the nav, a one-line
  // hero takes its place above the strip. Without hover, the row nearest the middle of the free part of the
  // screen becomes the active one, but only once the reader has scrolled. One read pass per frame at most,
  // no writes to layout.
  useEffect(() => {
    if (!(phone && layout) && !scrollLinked) return undefined
    let frame = 0
    let moved = false
    const measure = () => {
      frame = 0
      const head = document.querySelector('header.top')
      const headBottom = head ? head.getBoundingClientRect().bottom : 0
      let pinned = false
      if (phone && heroRef.current) {
        const band = headBottom + (miniRef.current?.offsetHeight || 0)
        const next = heroRef.current.getBoundingClientRect().bottom < band
        setMini(prev => (prev === next ? prev : next))
        // Pinned once the strip's top has reached its sticky spot under the one-line hero.
        const top = stickRef.current?.getBoundingClientRect().top
        pinned = Number.isFinite(top) && top <= band + 0.5
        setStuck(prev => (prev === pinned ? prev : pinned))
      }
      if (!scrollLinked || !moved) return
      const stack = stickRef.current?.getBoundingClientRect()
      const top = freeTop(headBottom, stack?.bottom, pinned)
      const bottom = window.innerHeight
      const rows = [...document.querySelectorAll('.tablecard tbody tr[data-rank]')].map(row => {
        const box = row.getBoundingClientRect()
        return { rank: Number(row.dataset.rank), top: box.top, bottom: box.bottom }
      })
      const rank = nearestRow(rows, readingLine(top, bottom), { from: top, to: bottom })
      setScrollRank(prev => (prev === rank ? prev : rank))
    }
    const queue = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const onScroll = () => {
      moved = true
      queue()
    }
    queue()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', queue)
    }
  }, [phone, layout, scrollLinked, all, from])

  // Measure label widths again once the web font has arrived.
  useEffect(() => {
    if (!split || !document.fonts?.ready) return undefined
    let cancel = false
    document.fonts.ready.then(() => { if (!cancel) setMeasure(() => canvasMeasure()) })
    return () => { cancel = true }
  }, [split])

  // Which places the table is showing right now: drives the band in the strip and the chip.
  useEffect(() => {
    if (!railed) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const shown = [...document.querySelectorAll('tbody tr[data-rank]')].filter(row => {
        const box = row.getBoundingClientRect()
        const middle = (box.top + box.bottom) / 2
        return box.height > 0 && middle > 0 && middle < window.innerHeight
      }).map(row => Number(row.dataset.rank))
      const table = document.querySelector('main table')
      const above = table ? table.getBoundingClientRect().bottom < 0 : false
      if (table) {
        const pin = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head')) || 66) + 24
        if (table.getBoundingClientRect().top < pin) table.dataset.stuck = ''
        else delete table.dataset.stuck
      }
      const next = shown.length
        ? { lo: Math.min(...shown), hi: Math.max(...shown), above: false }
        : { lo: Infinity, hi: -Infinity, above }
      setSeen(prev => (prev && prev.lo === next.lo && prev.hi === next.hi && prev.above === next.above ? prev : next))
    }
    const queue = () => { if (!frame) frame = requestAnimationFrame(measure) }
    queue()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
    }
  }, [railed, all, from, event.slug])

  useEffect(() => {
    if (pending.current == null) return
    const rank = pending.current
    pending.current = null
    reveal(rank)
  })

  const cap = all ? Infinity : Math.max(22, Math.max(event.line?.rank || 0, field?.rank || 0) + 6)
  const visible = event.rows.filter(row => row.rank >= from && row.rank <= cap)
  const moreBelow = event.rows.some(row => row.rank > cap)
  // The rows are one tab stop: the last row focused, or the first row shown. Arrows move between them.
  const ranks = visible.map(row => row.rank)
  const stop = ranks.includes(cursor) ? cursor : ranks[0]

  function moveRow(key, rank) {
    if (key.target !== key.currentTarget) return
    const at = ranks.indexOf(rank)
    const next = {
      ArrowDown: ranks[Math.min(at + 1, ranks.length - 1)],
      ArrowUp: ranks[Math.max(at - 1, 0)],
      Home: ranks[0],
      End: ranks.at(-1),
    }[key.key]
    if (next == null) return
    key.preventDefault()
    if (next === rank) return
    setCursor(next)
    bodyRef.current?.querySelector(`tr[data-rank="${next}"]`)?.focus()
  }
  const nextOut = event.line ? event.rows.find(row => row.rank === event.line.rank + 1) : null
  const listWord = context.past ? `${yearLabel(context.year)} final list` : context.final ? 'final list' : 'list'

  function outsideCopy() {
    if (!nextOut || !event.line || !Number.isFinite(nextOut.v)) return ''
    const gap = gapToLine(event.kind, event.line.v, nextOut.v)
    if (Math.abs(gap) < 1e-9) {
      const name = event.isRelay ? tidy(nextOut.team || nextOut.athlete) : surname(nextOut.athlete)
      return `${name}, ${ordinal(nextOut.rank)}, has the same mark and is listed after`
    }
    return `First one out is ${Math.abs(gap).toFixed(event.kind === 'points' ? 0 : 2)}${unitWord(event.kind)} back`
  }

  function remember() {
    if (!opening || !event.line || !finishRef.current) return
    const count = event.rows.filter(row => Number.isFinite(row.v) && (
      event.kind === 'time' ? row.v <= opening.v : row.v >= opening.v
    )).length
    const shown = [...document.querySelectorAll('tbody tr[data-rank]')].filter(row => row.offsetParent)
    const rowH = shown[1] ? shown[1].getBoundingClientRect().top - shown[0].getBoundingClientRect().top : 41
    const lastShown = shown.length ? Number(shown.at(-1).dataset.rank) : event.line.rank
    const off = count >= event.rows.length
    const shift = off ? 0 : (Math.min(count, lastShown) - event.line.rank) * rowH
    const when = shortDate(opening.d)
    const mark = formatMark(opening.v, event.kind)
    const text = off
      ? `${when}’s line, ${mark}, wouldn’t make today’s top ${event.rows.length}`
      : `${when}’s line, ${mark}, would sit ${ordinal(count)} today`
    let strip = null
    if (column) {
      const meters = metersAhead(event.dist, event.line.v, opening.v)
      const y = column.yAt(meters)
      const floor = column.height - column.bottom
      const held = Math.min(Math.max(y, 2), floor - 2)
      strip = {
        dy: held - column.lineY,
        opacity: y < 0 || y > floor ? 0.35 : 1,
        y: held > 48 ? held - 28 : held + 20,
        lines: [`${when}’s line, ${mark},`, `runs ${formatMeters(meters)} ${meters > 0 ? 'ahead of' : 'behind'} today’s`],
      }
    } else if (layout) {
      const meters = metersAhead(event.dist, event.line.v, opening.v)
      const x = layout.xAt(meters)
      strip = {
        dx: Math.max(0, x) - layout.lineX,
        opacity: x < 0 ? 0.35 : 1,
        x: Math.max(0, x) + 8,
        text: `${when}’s line, ${mark}, runs ${formatMeters(meters)} ${meters > 0 ? 'ahead of' : 'behind'} today’s`,
      }
    }
    setMemory({ shift, off, text, strip })
  }

  function nameOf(rank) {
    const row = event.rows.find(item => item.rank === rank)
    if (!row) return `Place ${rank}`
    return event.isRelay ? tidy(row.team || row.athlete) : surname(row.athlete)
  }

  function reveal(rank) {
    const row = document.querySelector(`tbody tr[data-rank="${rank}"]`)
    if (!row) {
      pending.current = rank
      setAll(true)
      setFrom(1)
      return
    }
    row.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    row.focus({ preventScroll: true })
    setHover({ rank, fromStrip: true, held: true })
    setPointed(null)
  }

  const offscreen = pointed != null && seen && (pointed < seen.lo || pointed > seen.hi)
  const chip = offscreen ? {
    rank: pointed,
    text: `${pointed}. ${nameOf(pointed)}`,
    down: Number.isFinite(seen.hi) ? pointed > seen.hi : !seen.above,
  } : null

  // The button's name starts with its visible words, then says what pressing and holding does.
  const lineGoes = query.season === 'indoor' ? 'go to nationals' : 'qualify'
  const lineWhy = nextOut ? (memory?.text || outsideCopy()) : ''
  const lineWords = `Qualifying line, top ${event.line?.rank} ${lineGoes}${lineWhy ? `, ${lineWhy.replace(/^First one out/, 'first one out')}` : ''}.`
  const holdLabel = opening
    ? `${lineWords} Press and hold to see where the ${shortDate(opening.d)} line would sit today.`
    : lineWords

  const who = event.line
    ? (event.isRelay ? tidy(event.line.team || event.line.athlete) : `${surname(event.line.athlete)}, ${tidy(event.line.team)}`)
    : ''
  const fieldWords = fieldSentence(event)
  const lines = pastLines(past, { season: query.season, region: query.region, gender: query.gender, event: event.name })
  const details = (
    <Details
      event={event}
      query={query}
      go={go}
      context={context}
      points={points}
      trend={trend}
      trendSeries={trendSeries}
      lines={lines}
    />
  )

  const sheet = (
    <>
      <section className="herocard" ref={heroRef}>
        {compact && (
          <h1>
            <button
              type="button"
              className="picker press"
              aria-haspopup="dialog"
              aria-label={`Change event, gender or season. Now: ${title}, ${query.season} ${yearLabel(context.year)}`}
              onClick={onOpenPicker}
            >
              {title}{CHEVRON}
            </button>
          </h1>
        )}
        {!compact && <h1>{title}</h1>}
        <div className="hero">
          {event.line ? (
            <div className="num" aria-label={lineLabel(event)}>
              {formatBare(event.line.v, event.kind)}{event.kind === 'mark' && <small>m</small>}{event.kind === 'points' && <small>pts</small>}<Mark text="" conversion={event.line.conversion} raw={event.line.raw} />
            </div>
          ) : (
            <div className="num unavailable">Cutoff unavailable</div>
          )}
          {event.line && (
            <p className="lead">
              <Logo team={event.line.team || event.line.athlete} className="lead-logo" />{ordinal(event.line.rank)} on the {listWord}: {who}.
              {fieldWords && <>{' '}<span className="field-lead">{fieldWords}</span></>}
            </p>
          )}
          {!event.line && fieldWords && <p className="lead"><span className="field-lead">{fieldWords}</span></p>}
          {!phone && details}
          {event.droppedAfterMeet && context.championship && (
            <p className="trend season-trend">
              {query.season === 'outdoor'
                ? 'No saved lists before the First Round, so there’s no season to show.'
                : 'No saved lists before the championships, so there’s no season to show.'}
            </p>
          )}
        </div>
      </section>
      {layout && (
        <div className={`stick${phone && stuck ? ' stuck' : ''}`} ref={stickRef}>
          {phone && (
            <div className={`minihero${mini ? ' on' : ''}`} ref={miniRef} aria-hidden="true">
              <span className="mini-t">{title}</span>
              <span className="mini-n">{event.line ? <Mark text={formatMark(event.line.v, event.kind)} conversion={event.line.conversion} interactive={false} /> : null}</span>
            </div>
          )}
          <RaceStrip
            layout={layout}
            card
            phone={phone}
            kind={event.kind}
            lineRank={event.line.rank}
            caption={phone
              ? null
              : (
                <>
                  The top {event.rows.length} as one race, as <Mark text={formatMark(event.line.v, event.kind)} conversion={event.line.conversion} raw={event.line.raw} /> crosses the line. Meters are estimates from each mark’s average speed.
                </>
              )}
            activeRank={hover?.rank ?? null}
            scrollRank={scrollLinked ? scrollRank : null}
            onHover={rank => setHover(rank == null ? null : { rank, fromStrip: true })}
            memory={memory?.strip || null}
            runKey={`ran:${query.season}:${query.gender}:${event.slug}`}
          />
        </div>
      )}
      {layout && phone && <p className="strip-cap">Top {event.rows.length} as one race. Meters are estimates.</p>}
      <section className="tablecard">
        <table id="list" aria-label={`${title} around the qualifying line`} className={event.isRelay ? 'relay' : undefined}>
          <thead>
            <tr>
              <th>Place</th>
              <th>Athlete</th>
              {!event.isRelay && <th>Team</th>}
              <th className="r">{event.kind === 'time' ? 'Time' : event.kind === 'mark' ? 'Mark (m)' : 'Points'}</th>
              <th className="r">To the line</th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {from > 1 && (
              <tr className="up">
                <td colSpan={event.isRelay ? 4 : 5}>
                  <button type="button" className="more press" id="up" onClick={() => { opened.current = true; setFrom(1) }}>
                    Show places 1–{from - 1}
                  </button>
                </td>
              </tr>
            )}
            {visible.map(row => {
              const inside = event.line && row.rank <= event.line.rank
              const bubble = event.line && row.rank === event.line.rank
              const gap = event.line && Number.isFinite(row.v) && !bubble ? formatGap(event.kind, gapToLine(event.kind, event.line.v, row.v)) : ''
              const name = event.isRelay ? tidy(row.team || row.athlete) : surname(row.athlete)
              return (
                <FragmentRow
                  key={row.rank}
                  row={row}
                  event={event}
                  name={name}
                  gap={gap}
                  inside={inside}
                  bubble={bubble}
                  hover={hover}
                  setHover={setHover}
                  active={scrollLinked && scrollRank === row.rank}
                  stop={row.rank === stop}
                  tag={field ? (field.in.has(row.rank) ? 'in' : field.out.has(row.rank) ? 'out' : null) : null}
                  fieldLine={field && row.rank === field.rank ? <FieldLine field={field} event={event} /> : null}
                  onFocusRow={() => setCursor(row.rank)}
                  onMove={key => moveRow(key, row.rank)}
                  hoverable={!scrollLinked}
                  line={bubble ? (
                    <tr className="line">
                      <td colSpan={event.isRelay ? 4 : 5}>
                        <button
                          type="button"
                          className={`finish${memory?.off ? ' off' : ''}`}
                          id="finish"
                          ref={finishRef}
                          aria-label={holdLabel}
                          style={memory?.shift ? { transform: `translateY(${memory.shift}px)` } : undefined}
                          onPointerDown={eventDown => {
                            if (eventDown.button !== 0 || !opening) return
                            eventDown.currentTarget.setPointerCapture?.(eventDown.pointerId)
                            clearTimeout(timer.current)
                            timer.current = setTimeout(remember, 300)
                          }}
                          onPointerUp={() => { clearTimeout(timer.current); setMemory(null) }}
                          onPointerCancel={() => { clearTimeout(timer.current); setMemory(null) }}
                          onKeyDown={key => { if (key.key === ' ' && !key.repeat && opening) { key.preventDefault(); remember() } }}
                          onKeyUp={key => { if (key.key === ' ') setMemory(null) }}
                        >
                          <span><b>Qualifying line</b> · top {event.line.rank} {lineGoes}</span>{' '}
                          {nextOut && <span className="why">{lineWhy}</span>}
                        </button>
                      </td>
                    </tr>
                  ) : null}
                />
              )
            })}
          </tbody>
        </table>
        {moreBelow && <button type="button" className="more press show-all" onClick={() => setAll(true)}>Show all {event.rows.length}</button>}
      </section>
    </>
  )

  return (
    <>
      {railed ? (
        <div className="split">
          <div className="split-sheet">{sheet}</div>
          <RaceColumn
            layout={column}
            kind={event.kind}
            lineRank={event.line.rank}
            activeRank={hover?.rank ?? null}
            onSize={size => setRailSize(prev => (prev && prev.width === size.width && prev.height === size.height ? prev : size))}
            onHover={rank => {
              setHover(rank == null ? null : { rank, fromStrip: true })
              if (rank != null) setPointed(rank)
            }}
            onLeave={() => {
              setPointed(null)
              setHover(prev => (prev?.fromStrip && !prev.held ? null : prev))
            }}
            memory={memory?.strip || null}
            seen={seen && Number.isFinite(seen.lo) ? seen : null}
            chip={chip}
            onChip={() => chip && reveal(chip.rank)}
            caption={(
              <>
                The top {event.rows.length} as one race, as <Mark text={formatMark(event.line.v, event.kind)} conversion={event.line.conversion} raw={event.line.raw} /> crosses the line. Meters are estimates from each mark’s average speed.
              </>
            )}
          />
        </div>
      ) : sheet}
      {phone && details}
      <Source
        season={query.season}
        year={context.year}
        region={query.region}
        listDate={context.listDate}
        final={context.final}
        list={context.list}
        query={query}
        go={go}
        footnote={footnote || event.rows.some(row => row.conversion) || Boolean(event.line?.conversion)}
        extra={points.length ? LIST_NOTE : null}
        after={event.droppedAfterMeet && context.championship ? (
          <>
            {' '}Before <time dateTime={context.championship.start_date}>{longDate(context.championship.start_date)}</time>
            {' · '}
            <a href={context.championship.source}>{context.championship.name}</a>.
          </>
        ) : null}
      />
    </>
  )
}

const LIST_NOTE = 'Saved daily lists hold the top 20 marks from mid-January to late May and the top 50 after that.'

// Two cards under the cutoff: how it moved this season and how it compares with past years. Each opens
// its dialog; the card says the one thing worth knowing so the dialog is only for the detail.
function Details({ event, query, go, context, points, trend, trendSeries, lines }) {
  const seasonCard = points.length >= 1
  const historyCard = lines.length > 0
  if (!seasonCard && !historyCard) return null
  const open = click => { if (plainClick(click)) go(click.currentTarget.href, click) }
  return (
    <div className="details">
      {seasonCard && (
        <a className="detail-card press" data-detail="season" href={detailHref(query, 'season', event.slug)} aria-haspopup="dialog" onClick={open}>
          <span className="detail-t">This season</span>
          {trend.length >= 1 && <Spark series={trendSeries} kind={event.kind} />}
          <span className="detail-x">{seasonSentence(event, trend)}</span>
          <span className="detail-go">Day by day{ARROW}</span>
        </a>
      )}
      {historyCard && (
        <a className="detail-card press" data-detail="history" href={detailHref(query, 'history', event.slug)} aria-haspopup="dialog" onClick={open}>
          <span className="detail-t">Past years</span>
          <YearSpark lines={lines} kind={event.kind} currentYear={context.year} />
          <span className="detail-x">{historySentence(lines, event.kind, context)}</span>
          <span className="detail-go">Every season{ARROW}</span>
        </a>
      )}
    </div>
  )
}

function seasonSentence(event, trend) {
  if (!trend.length) return 'How the cutoff moved, day by day.'
  const opening = trend[0]
  const latest = trend.at(-1)
  const when = shortDate(opening.d)
  const was = formatMark(opening.v, event.kind)
  if (trend.length === 1) return <>The cutoff was {was} on {when}, the first saved list.</>
  const delta = latest.v - opening.v
  if (Math.abs(delta) < (event.kind === 'points' ? 0.5 : 0.005)) return <>The cutoff hasn’t moved since {when}.</>
  const better = event.kind === 'time' ? delta < 0 : delta > 0
  const word = event.kind === 'time' ? (better ? 'faster' : 'slower') : (better ? 'better' : 'worse')
  return <>The cutoff got <b>{Math.abs(delta).toFixed(event.kind === 'points' ? 0 : 2)}{unitWord(event.kind)} {word}</b> since {when}, when it was {was}.</>
}

function historySentence(lines, kind, context) {
  const lead = pastSummary(lines, kind, context.year)
  if (!lead) return `The final cutoff for ${lines.length} past season${lines.length === 1 ? '' : 's'}.`
  const whose = context.past ? `The ${yearLabel(context.year)} cutoff` : lead.currentIsNow ? 'This season’s cutoff' : 'The latest cutoff'
  return <>{whose} is the <b>{lead.phrase}</b> of {lead.count} seasons.</>
}

function lineLabel(event) {
  const mark = formatMark(event.line.v, event.kind)
  const phrase = accessibleConversion(event.line.conversion)
  return phrase ? `Qualifying line ${mark}, ${phrase}` : `Qualifying line ${mark}`
}

function rowLabel(event, row, name, tag) {
  const mark = formatMark(row.v, event.kind)
  const phrase = accessibleConversion(row.conversion)
  const shown = phrase ? `${mark}, ${phrase}` : mark
  const base = event.isRelay ? `${row.rank}. ${name}, ${shown}` : `${row.rank}. ${name}, ${tidy(row.team)}, ${shown}`
  const status = [rowStatus(event, row), TAG_LABEL[tag]].filter(Boolean).join(', ')
  return status ? `${base}, ${status}` : base
}

// The row's tag, in the words its name uses. The accepted list can't tell a scratch from an athlete who
// never declared, so "not in field" says only that.
const TAG_TEXT = { in: 'in', out: 'not in field' }
const TAG_LABEL = { in: 'in the field', out: 'not in the field' }

// The hero's second sentence: how deep the field as accepted reached, or why there is no field line.
function fieldSentence(event) {
  const field = event.field
  if (!field) return ''
  const cancelled = field.cancelled ? ' The meet was cancelled.' : ''
  if (field.status === 'unmatched') {
    return `No field line: ${field.unmatched} accepted ${field.unmatched === 1 ? 'entry isn’t' : 'entries aren’t'} matched to this list.${cancelled}`
  }
  if (field.status === 'beyond_list') return `The field reached past the ${event.rows.length} places on this list.${cancelled}`
  if (event.line && field.rank === event.line.rank) return `The field held at the line.${cancelled}`
  const entry = field.entry
  const who = event.isRelay ? tidy(entry.team || entry.athlete) : [surname(entry.athlete), tidy(entry.team)].filter(Boolean).join(', ')
  return (
    <>
      The field reached {ordinal(field.rank)}: {who} (<Mark text={formatMark(entry.v, event.kind)} conversion={entry.conversion} raw={entry.raw} />).{cancelled}
    </>
  )
}

// A second rule under the deepest place the field took, dashed so it never reads as the qualifying line.
function FieldLine({ field, event }) {
  const held = event.line && field.rank === event.line.rank
  return (
    <tr className="fieldrow">
      <td colSpan={event.isRelay ? 4 : 5}>
        <div className="fieldline">
          <span><b>Field line</b> · {held ? 'held at the line' : `reached ${ordinal(field.rank)}`}</span>{' '}
          <span className="why">as accepted {shortDate(field.accepted)}{field.cancelled ? ' · meet cancelled' : ''}</span>
        </div>
      </td>
    </tr>
  )
}

// In or out, and how far from the line: what the row's place against the line row and its colour show.
function rowStatus(event, row) {
  if (!event.line) return ''
  const inside = row.rank <= event.line.rank
  const word = inside ? 'in' : 'out'
  if (row.rank === event.line.rank) return `${word}, on the line`
  if (!Number.isFinite(row.v)) return word
  const gap = gapToLine(event.kind, event.line.v, row.v)
  const digits = event.kind === 'points' ? 0 : 2
  if (Math.abs(gap) < (digits === 0 ? 0.5 : 1e-9)) return `${word}, level with the line`
  const size = `${Math.abs(gap).toFixed(digits)}${unitWord(event.kind)}`
  return `${word}, ${size} ${gap < 0 ? 'ahead of' : 'behind'} the line`
}

// Where scrolling picks the row there is no hover: a row passing under a resting finger or pointer must
// not take over the strip's readout. A tap still selects the row, through focus.
function FragmentRow({
  row, event, name, gap, inside, bubble, hover, setHover, line, fieldLine = null, tag = null, active = false, hoverable = true, stop = false, onFocusRow, onMove,
}) {
  const on = hover?.fromStrip && hover.rank === row.rank
  return (
    <>
      <tr
        className={`${bubble ? 'in bubble' : inside ? 'in' : 'out'}${on ? ' on' : ''}${active ? ' act' : ''}`}
        data-rank={row.rank}
        tabIndex={stop ? 0 : -1}
        aria-label={rowLabel(event, row, name, tag)}
        onPointerEnter={hoverable ? () => setHover({ rank: row.rank, fromStrip: false }) : undefined}
        onPointerLeave={hoverable ? () => setHover(null) : undefined}
        onFocus={() => {
          onFocusRow?.()
          setHover({ rank: row.rank, fromStrip: false })
        }}
        onKeyDown={onMove}
        onBlur={() => setHover(null)}
      >
        <td className="pl">{row.rank}</td>
        <td className="ath">
          {event.isRelay ? <span className="tl tx"><Logo team={row.team || row.athlete} />{name}</span> : <span className="tx">{name}</span>}
          {tag && <>{' '}<span className={`tag tag-${tag}`}>{TAG_TEXT[tag]}</span></>}
        </td>
        {!event.isRelay && <td className="team"><span className="tl tx"><Logo team={row.team} />{tidy(row.team)}</span></td>}
        <td className="t r"><Mark text={formatBare(row.v, event.kind)} conversion={row.conversion} raw={row.raw} hang /></td>
        <td className="gap r"><span>{gap}</span></td>
      </tr>
      {line}
      {fieldLine}
    </>
  )
}
