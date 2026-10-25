import { useEffect, useMemo, useRef, useState } from 'react'
import { axisDates, finitePoints, stepPath } from '../utils/chart'
import {
  accessibleConversion, FOOTNOTE, formatMark, genderWord, longDate, ordinal, shortDate, surname, unitWord,
} from '../utils/format'
import { usePhone, useWidth } from '../utils/media'
import { listLink } from '../utils/route'
import { pastLines, seasonLabel } from '../utils/past'
import { dailyDays } from '../utils/daily'
import { layoutStrip, scaleFor } from '../utils/strip'
import { Mark, SvgMark } from './Mark'
import RaceStrip from './RaceStrip'
import { DetailHero } from './DetailSheet'

// The season dialog: the cutoff each saved day, and any day's top 20 as one race.
export default function SeasonDetail({ event, query, context, past = null }) {
  const phone = usePhone()
  const widthPx = useWidth()
  const [daily, setDaily] = useState(null)
  const [dailyError, setDailyError] = useState(false)
  const points = finitePoints(event.series)
  useEffect(() => {
    let cancel = false
    loadDaily(context.days)
      .then(saved => { if (!cancel) setDaily(saved) })
      .catch(() => { if (!cancel) setDailyError(true) })
    return () => { cancel = true }
  }, [context.days])
  const days = useMemo(() => dailyDays(daily, event), [daily, event])
  const lines = pastLines(past, {
    season: query.season,
    region: query.region,
    gender: query.gender,
    event: event.name,
  })

  if (!event.tracked) {
    return (
      <>
        <DetailHero
          lead={event.droppedAfterMeet && context.championship
            ? 'No lists were saved before this championship.'
            : 'Saved daily lists cover running events only, so there’s no day-by-day chart for this event.'}
          stats={event.line ? [{
            label: context.final ? 'Final list' : 'Latest list',
            value: <Mark text={formatMark(event.line.v, event.kind)} conversion={event.line.conversion} raw={event.line.raw} />,
            accent: true,
          }] : []}
        />
        <p className="source">
          <SavedThrough date={context.listDate} championship={context.championship} />
          {seasonFlagged(event, lines) && <> {FOOTNOTE}</>}
        </p>
      </>
    )
  }

  return (
    <SeasonChart
      event={event}
      query={query}
      context={context}
      phone={phone}
      widthPx={widthPx}
      points={points}
      days={days}
      daily={daily}
      dailyError={dailyError}
      lines={lines}
    />
  )
}

// A season's saved days load when its dialog opens; there are none to load for a season without a chart.
function loadDaily(name) {
  if (!name) return Promise.resolve({})
  return fetch(`${import.meta.env.BASE_URL}data/${name}`).then(res => {
    if (!res.ok) throw new Error('missing')
    return res.json()
  })
}

function SeasonChart({ event, query, context, phone, widthPx, points, days, daily, dailyError, lines }) {
  const big = !phone
  // On a phone only this season's mark labels the end: past seasons have their own dialog.
  const priorLines = big ? (lines || []).filter(line => line.comparable && line.year !== context.year && Number.isFinite(line.v)).slice(0, 2) : []
  // Drawn at the width it is shown, inside the dialog's and the card's padding, so the text keeps its
  // size: the dialog is 880px at most, 16px narrower than a phone.
  const sheet = big ? Math.min(880, widthPx - 48) : widthPx - 16
  const W = big ? sheet - 80 : Math.max(260, sheet - 44)
  const H = big ? 340 : 230
  const endLabel = formatMark(finitePoints(event.series).at(-1).v, event.kind)
  const m = big ? { l: 64, r: 170, t: 34, b: 40 } : { l: 48, r: Math.ceil(textWidth(endLabel, true)) + 22, t: 26, b: 30 }
  const start = event.series[0].d
  const end = event.series.at(-1).d
  const values = points.map(point => point.v)
  const range = Math.max(...values) - Math.min(...values)
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  const tick = steps.find(step => range / step <= (big ? 7 : 5)) || 1
  const lo = Math.floor(Math.min(...values) / tick) * tick
  const hi = Math.ceil(Math.max(...values) / tick) * tick
  const plot = stepPath(event.series, m.l, W - m.r, m.t, H - m.b, start, end, lo, hi, event.kind !== 'time')
  const endX = plot.tx(end)
  const opening = points[0]
  const last = points.at(-1)
  const change = last.v - opening.v
  const better = event.kind === 'time' ? change < 0 : change > 0
  const word = event.kind === 'time' ? (better ? 'faster' : 'slower') : (better ? 'better' : 'worse')
  const still = Math.abs(change) < (event.kind === 'points' ? 0.5 : 0.005)
  const drag = useRef(false)
  const [pick, setPick] = useState(null)
  const [scrubbed, setScrubbed] = useState(false)
  const idx = pick == null ? indexFor(days, query.day, end) : pick
  const safeIdx = days.length ? Math.min(Math.max(idx, 0), days.length - 1) : 0
  const domain = useMemo(() => seasonDomain(days, event), [days, event])
  const stripWidth = big ? sheet - 64 : Math.max(260, sheet - 40)
  const day = days[safeIdx]
  const layout = day ? layoutStrip({
    rows: day.r.map((row, index) => ({ rank: index + 1, name: row[1] || '', v: row[0] })),
    lineV: day.r[event.line.rank - 1][0],
    scale: scaleFor(event),
    rank: event.line.rank,
    width: stripWidth,
    radius: phone ? 4.5 : 8,
    phone,
    domain,
  }) : null

  function choose(next) {
    const clamped = Math.max(0, Math.min(days.length - 1, next))
    setScrubbed(true)
    setPick(clamped)
    const picked = days[clamped]
    if (!picked) return
    const url = new URL(window.location.href)
    if (picked.d === end) url.searchParams.delete('d')
    else url.searchParams.set('d', picked.d)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  function atPointer(eventPointer) {
    const bounds = eventPointer.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (eventPointer.clientX - bounds.left) / bounds.width))
    const target = new Date(`${start}T12:00:00`).getTime() + t * (new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`))
    let found = 0
    days.forEach((item, index) => { if (new Date(`${item.d}T12:00:00`).getTime() <= target) found = index })
    return found
  }

  const held = points.findIndex(point => point.v === last.v)
  const hold = big && held >= 0 ? holdNote(plot, points[held], end, event, last.v) : null
  const drop = big ? dropNote(plot, biggestDrop(event), event.kind) : null
  const room = { left: m.l + 4, right: W - m.r - 8, top: m.t, bottom: H - m.b - 6 }
  const notes = placeNotes([hold, drop].filter(Boolean), room, lineBoxes(event.series, plot, end))
  const grid = []
  for (let value = lo; value <= hi + 1e-9; value += tick) {
    const y = plot.ty(round(value))
    grid.push({ value: round(value), y })
  }

  return (
    <>
      <DetailHero
        lead={`The mark you needed to be ${ordinal(event.line.rank)}, on each saved day from ${shortDate(opening.d)} to ${shortDate(end)}.`}
        stats={[
          { label: `On ${shortDate(opening.d)}`, value: formatMark(opening.v, event.kind) },
          {
            label: context.final ? 'Final list' : 'Latest list',
            value: <Mark text={formatMark(last.v, event.kind)} conversion={event.line.conversion} raw={event.line.raw} />,
          },
          {
            label: 'Change',
            value: still ? 'None' : `${Math.abs(change).toFixed(event.kind === 'points' ? 0 : 2)}${unitWord(event.kind)} ${word}`,
            accent: !still,
          },
        ]}
      />
      <section className="detail-box">
        <h3 className="detail-sub">Day by day</h3>
      <div className="chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`The ${genderWord(query.gender)} ${event.label.toLowerCase()} cutoff by day, ${shortDate(start)} to ${shortDate(end)}: ${formatMark(opening.v, event.kind)} to ${formatMark(last.v, event.kind)}${accessibleConversion(event.line?.conversion) ? `, ${accessibleConversion(event.line.conversion)}` : ''}. Rank ${event.line.rank}.`}
          data-observations={JSON.stringify(event.series.map(point => [point.d, point.v]))}
        >
          {grid.map(line => (
            <g key={line.value}>
              <line className="grid" x1={m.l} x2={W - m.r} y1={line.y} y2={line.y} />
              <text x={m.l - 10} y={line.y + 5} textAnchor="end">{formatMark(line.value, event.kind).replace(/\.00$/, '')}</text>
            </g>
          ))}
          {axisDates(start, end, phone).map(date => (
            <text key={date} x={plot.tx(date)} y={H - m.b + 26} textAnchor={date === start ? 'start' : 'middle'}>{shortDate(date)}</text>
          ))}
          <text className="k" x={m.l - 10} y={m.t - 16} textAnchor="end">{event.kind === 'time' ? 'Faster ↑' : 'Better ↑'}</text>
          <path className="step" d={plot.d} />
          <line className="end" x1={endX} x2={endX} y1={m.t - 8} y2={H - m.b} />
          <text className="k" x={endX} y={H - m.b + 26} textAnchor={big ? 'middle' : 'end'}>{shortDate(end)}</text>
          {notes.map(note => <Note key={note.key} note={note} />)}
          <EndNotes
            big={big}
            endX={endX}
            last={last}
            event={event}
            context={context}
            plot={plot}
            priorLines={priorLines.filter(line => line.v >= lo && line.v <= hi)}
          />
          {day && day.d !== end && (
            <g className="cursor">
              <line className="cur" x1={plot.tx(day.d)} x2={plot.tx(day.d)} y1={m.t - 8} y2={H - m.b} />
              <text className="k" x={plot.tx(day.d)} y={m.t - 16} textAnchor={plot.tx(day.d) > W * 0.6 ? 'end' : 'start'}>
                {shortDate(day.d)} · {formatMark(day.r[event.line.rank - 1][0], event.kind)}
              </text>
            </g>
          )}
        </svg>
        {days.length > 0 && (
          <div
            className="scrub"
            role="slider"
            tabIndex={0}
            aria-label="Day to show"
            aria-valuemin={0}
            aria-valuemax={days.length - 1}
            aria-valuenow={safeIdx}
            aria-valuetext={`${shortDate(day.d)}, cutoff ${formatMark(day.r[event.line.rank - 1][0], event.kind)}`}
            style={{ left: `${m.l / W * 100}%`, right: `${m.r / W * 100}%` }}
            onPointerDown={eventPointer => {
              drag.current = true
              eventPointer.currentTarget.setPointerCapture?.(eventPointer.pointerId)
              choose(atPointer(eventPointer))
            }}
            onPointerMove={eventPointer => { if (drag.current) choose(atPointer(eventPointer)) }}
            onPointerUp={() => { drag.current = false }}
            onPointerCancel={() => { drag.current = false }}
            onKeyDown={key => {
              const step = { ArrowLeft: -1, ArrowRight: 1, Home: -1e9, End: 1e9 }[key.key]
              if (step == null) return
              key.preventDefault()
              choose(safeIdx + step)
            }}
          />
        )}
      </div>
        {days.length > 0 && <p className="detail-hint">Drag across the chart, or use the arrow keys on it, to show any saved day below.</p>}
      </section>
      {layout && (
        <section className="detail-track">
          <h3 className="detail-sub">{shortDate(day.d)}{day.d === end ? `, ${context.final ? 'final' : 'latest'} list` : ''}: the top 20 as one {event.kind === 'time' ? 'race' : 'competition'}</h3>
          <RaceStrip
            layout={layout}
            kind="time"
            lineRank={event.line.rank}
            caption={null}
            glide={scrubbed}
            card
            phone={phone}
            fit
          />
        </section>
      )}
      {event.strip && daily == null && (
        <div className={`race fit pending${dailyError ? ' failed' : ''}`} aria-busy={!dailyError}>
          {dailyError && <p>Couldn’t load the saved daily lists. Reload to try again.</p>}
        </div>
      )}
      <p className="source">
        TFRRS {listPhrase(query, context)}. <SavedThrough date={end} championship={context.championship} />
        {days.length > 0 && ` Saved daily lists keep the top 20.${event.kind === 'time' ? ' Meters are estimates from each mark’s average speed.' : ''}`}
        {seasonFlagged(event, lines) && <> {FOOTNOTE}</>}
      </p>
    </>
  )
}

function EndNotes({ big, endX, last, event, context, plot, priorLines }) {
  const notes = [
    ...priorLines.map(line => ({
      key: line.year,
      y: plot.ty(line.v),
      before: big ? `${seasonLabel(line.year)}: ` : `${seasonLabel(line.year).slice(2)} `,
      mark: line.mark,
      conversion: line.conversion,
      after: '',
      tick: true,
    })),
    {
      key: 'now',
      y: plot.ty(last.v),
      before: '',
      mark: formatMark(last.v, event.kind),
      conversion: event.line?.conversion,
      after: big ? `, ${context.final ? 'final list' : 'latest list'}` : '',
      now: true,
    },
  ].filter(note => Number.isFinite(note.y))
  notes.sort((a, b) => a.y - b.y)
  let previous = -Infinity
  notes.forEach(note => {
    note.labelY = Math.max(note.y + 4, previous + 16)
    previous = note.labelY
  })
  return (
    <g>
      {notes.map(note => (
        <g key={note.key}>
          {note.tick && <line className="pastt" x1={endX - 12} x2={endX + 6} y1={note.y} y2={note.y} />}
          <text className={note.now ? 'k' : undefined} x={endX + 14} y={note.labelY}>
            <SvgMark before={note.before} mark={note.mark} conversion={note.conversion} after={note.after} />
          </text>
        </g>
      ))}
    </g>
  )
}

function seasonDomain(days, event) {
  const scale = scaleFor(event)
  if (!scale) return null
  const marks = days.flatMap(day => {
    const lineV = day.r[event.line.rank - 1][0]
    return day.r.map(row => scale.gap(lineV, row[0])).filter(Number.isFinite)
  })
  if (!marks.length) return null
  return [Math.min(0, ...marks), Math.max(0, ...marks)]
}

function biggestDrop(event) {
  let best = null
  for (let i = 1; i < event.series.length; i += 1) {
    const prev = event.series[i - 1]
    const next = event.series[i]
    if (!Number.isFinite(prev.v) || !Number.isFinite(next.v)) continue
    const delta = next.v - prev.v
    const improved = event.kind === 'time' ? delta < 0 : delta > 0
    if (!improved) continue
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { delta, prev, next }
  }
  return best
}

// About how wide a line of chart text is: 14px Archivo, a little wider when bold.
function textWidth(text, bold = false) {
  return text.length * (bold ? 7.9 : 7.4)
}

function dropNote(plot, drop, kind) {
  if (!drop) return null
  const unit = unitWord(kind)
  const word = kind === 'time' ? 'faster' : 'better'
  return {
    key: 'drop',
    x: plot.tx(drop.next.d),
    y: plot.ty(drop.next.v),
    title: `${shortDate(drop.next.d)}: biggest one-day change, ${Math.abs(drop.delta).toFixed(kind === 'points' ? 0 : 2)}${unit} ${word}`,
    body: `${formatMark(drop.prev.v, kind)} to ${formatMark(drop.next.v, kind)}`,
  }
}

function holdNote(plot, point, end, event, mark) {
  const days = Math.round((new Date(`${end}T12:00:00`) - new Date(`${point.d}T12:00:00`)) / 864e5)
  if (days < 1) return null
  const who = event.isRelay ? (event.line.team || event.line.athlete) : surname(event.line.athlete)
  return {
    key: 'hold',
    x: plot.tx(point.d),
    y: plot.ty(mark),
    title: `${shortDate(point.d)}: ${who} ${event.kind === 'time' ? 'runs' : 'marks'} `,
    mark: formatMark(mark, event.kind),
    conversion: event.line && Math.abs(mark - event.line.v) < 1e-6 ? event.line.conversion : null,
    body: `Still the cutoff ${days} day${days === 1 ? '' : 's'} later.`,
  }
}

// Where the step line runs, as boxes: one flat and one upright stretch per saved day.
function lineBoxes(series, plot, end) {
  const boxes = []
  const shown = series.filter(point => Number.isFinite(point.v))
  shown.forEach((point, index) => {
    const next = shown[index + 1]
    const y = plot.ty(point.v)
    boxes.push({ l: plot.tx(point.d), r: plot.tx(next ? next.d : end), t: y - 2, b: y + 2 })
    if (next) {
      const x = plot.tx(next.d)
      const ny = plot.ty(next.v)
      boxes.push({ l: x - 2, r: x + 2, t: Math.min(y, ny), b: Math.max(y, ny) })
    }
  })
  return boxes
}

const meets = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t

// Each note hangs under its point on a leader, or over it when there is no room below. It tries right of
// the point, then ending at the plot's edge, then left of it, a little further away each round, and takes
// the first spot clear of the line and of notes already placed. A note with no clear spot is left out.
function placeNotes(notes, room, line) {
  const placed = []
  notes.forEach(note => {
    const width = Math.max(textWidth(`${note.title}${note.mark || ''}`, true), textWidth(note.body))
    for (const drop of [24, 56, 84, 112, -24, -52]) {
      const top = drop > 0 ? note.y + drop : note.y + drop - 34
      if (top + 34 > room.bottom || top < room.top) continue
      const spots = [
        { l: note.x + 8, anchor: 'start' },
        { l: room.right - width, anchor: 'start' },
        { l: note.x - 8 - width, anchor: 'start' },
      ]
      const spot = spots.find(({ l }) => {
        if (l < room.left || l + width > room.right) return false
        const box = { l: l - 4, r: l + width + 4, t: top - 4, b: top + 38 }
        const leader = drop > 0
          ? { l: note.x - 1, r: note.x + 1, t: note.y + 8, b: top - 4 }
          : { l: note.x - 1, r: note.x + 1, t: top + 38, b: note.y - 8 }
        return !line.some(part => meets(box, part)) && !placed.some(other => meets(box, other.box) || meets(leader, other.box))
      })
      if (spot) {
        placed.push({ ...note, above: drop < 0, box: { l: spot.l, r: spot.l + width, t: top, b: top + 34 }, tx: spot.l, ty: top + 14 })
        return
      }
    }
  })
  return placed
}

function Note({ note }) {
  // The leader stops at the text when the text spans the point, and runs beside it otherwise.
  const spans = note.x > note.box.l - 4 && note.x < note.box.r + 4
  const y1 = note.above ? note.y - 6 : note.y + 6
  const y2 = spans ? (note.above ? note.box.b + 6 : note.box.t - 6) : note.box.t + 17
  return (
    <g>
      <line className="lead-l" x1={note.x} x2={note.x} y1={y1} y2={y2} />
      <text className="k" x={note.tx} y={note.ty}>
        {note.mark ? <SvgMark before={note.title} mark={note.mark} conversion={note.conversion} /> : note.title}
      </text>
      <text x={note.tx} y={note.ty + 20}>{note.body}</text>
    </g>
  )
}

function seasonFlagged(event, lines) {
  return Boolean(event?.line?.conversion) || lines.some(line => line.conversion)
}

function dayBefore(start) {
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function SavedThrough({ date, championship }) {
  if (!date && !championship) return 'Championship cutoff date unavailable for this season.'
  if (!date) {
    return (
      <>
        <time dateTime={championship.start_date}>{longDate(championship.start_date)}</time>
        {' · '}
        <a href={championship.source}>{championship.name}</a>.
      </>
    )
  }
  const when = `${shortDate(date)}, ${date.slice(0, 4)}`
  if (championship && date === dayBefore(championship.start_date)) {
    return (
      <>
        Saved daily through {when}, the day before the <a href={championship.source}><time dateTime={championship.start_date}>{championship.name}</time></a>.
      </>
    )
  }
  return (
    <>
      Saved daily through {when}.
      {championship && (
        <>
          {' '}
          <a href={championship.source}><time dateTime={championship.start_date}>{championship.name}</time></a>.
        </>
      )}
    </>
  )
}

function listPhrase(query, context) {
  const link = listLink(query.season, context.year, query.region)
  const label = link?.title || `${genderWord(query.gender, { possessive: true })} ${query.season} list`
  return link ? <a href={link.href}>{label}</a> : label
}

function indexFor(days, day, end) {
  if (!days.length) return 0
  const found = days.findIndex(item => item.d === (day || end))
  return found < 0 ? days.length - 1 : found
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
