import { useState } from 'react'
import { accessibleConversion, familyName, formatMark, ordinal, quietLines, symbolString, tidy } from '../utils/format'
import { comparedWord, pastSummary, seasonLabel, yearScale, yearTick } from '../utils/past'
import { Mark, SvgMark } from './Mark'
import { DetailHero } from './DetailSheet'
import Logo from './Logo'

const RECENT = 5

function atLine(line) {
  const athlete = line.athlete && line.athlete !== 'N/A' ? familyName(line.athlete) : ''
  const team = tidy(line.team)
  if (athlete && team && athlete !== team) return `${athlete}, ${team}`
  return athlete || team
}

function tieSentence(tie) {
  const name = tie.athlete && tie.athlete !== 'N/A' ? familyName(tie.athlete) : ''
  const team = tidy(tie.team)
  const who = name && team && name !== team ? `${name}, ${team}` : (name || team)
  return `${who}, has the same mark and is listed ${ordinal(tie.rank)}`
}

function shownMark(line, kind) {
  if (kind === 'time' || !Number.isFinite(line.v)) return line.mark || ''
  return formatMark(line.v, kind)
}

function pileSentence(line) {
  if (!line.comparable || !Number.isInteger(line.place) || line.place >= line.rank) return null
  const count = line.rank - line.place + 1
  return `Tied from ${ordinal(line.place)}, ${count} athletes at `
}

function conversionCopy(line) {
  if (line.converted) {
    const text = String(line.converted).replace(/\s+/g, ' ').replace(/\.$/, '')
    return /by TFRRS/i.test(text) ? `${text}.` : `${text} by TFRRS.`
  }
  if (!line.flag) return null
  if (line.flag.includes('@') && line.flag.includes('#')) return 'Converted for altitude and track size by TFRRS.'
  if (line.flag.includes('@')) return 'Converted for altitude by TFRRS.'
  if (line.flag.includes('(55)')) return 'Converted from a 55m track by TFRRS.'
  if (line.flag.includes('#')) return 'Converted for track size by TFRRS.'
  return null
}

// Next to the season's line: how deep its field as accepted reached, as "field reached 19th · 6.68 m".
function fieldNote(line, kind) {
  const field = line.field
  if (!field) return null
  const cancelled = field.cancelled ? ' · meet cancelled' : ''
  if (field.status === 'unmatched') return `Field not matched to the list${cancelled}`
  if (field.status === 'beyond_list') return `Field reached past the saved list${cancelled}`
  const held = field.rank === line.rank && line.comparable
  const mark = kind === 'time' || !Number.isFinite(field.v) ? field.mark : formatMark(field.v, kind)
  return (
    <>
      {held ? 'Field held at the line · ' : `Field reached ${ordinal(field.rank)} · `}
      <Mark text={mark} conversion={field.conversion} />{cancelled}
    </>
  )
}

function meetNote(line) {
  if (line.note === 'No meet (COVID)') return 'The championships were cancelled (COVID-19); the list was final.'
  if (line.rule === 'cancelled' || line.note === 'Season cancelled') return 'Season cancelled'
  return null
}

function gapText(line, current, kind, currentYear, selected) {
  if (!line.comparable || !current?.comparable || !Number.isFinite(line.v) || !Number.isFinite(current.v)) {
    return 'Not compared'
  }
  if (line.year === current.year && line.rank === current.rank) {
    return line.year === currentYear ? (selected ? 'Selected season' : 'This season') : 'Latest saved'
  }
  const delta = line.v - current.v
  if (Math.abs(delta) < (kind === 'points' ? 0.5 : 1e-9)) return 'Same mark'
  const amount = kind === 'time' ? `${Math.abs(delta).toFixed(2)}s` : formatMark(Math.abs(delta), kind)
  const improved = kind === 'time' ? delta < 0 : delta > 0
  return { amount, word: comparedWord(kind, improved) }
}

function tickLabel(value, kind) {
  if (kind === 'time') return formatMark(value, kind).replace(/\.00$/, '')
  return formatMark(value, kind)
}

function textWidth(text, font) {
  return text.length * font * 0.58
}

function plottedPoints(chrono, xOf, yOf) {
  return chrono.flatMap((line, index) => (
    Number.isFinite(line.v) ? [{ x: xOf(index), y: yOf(line.v) }] : []
  ))
}

function lowestLine(points, left, right) {
  let low = null
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const segLeft = Math.min(start.x, end.x)
    const segRight = Math.max(start.x, end.x)
    if (segRight < left || segLeft > right) continue
    const yAt = px => {
      if (end.x === start.x) return Math.max(start.y, end.y)
      const t = (px - start.x) / (end.x - start.x)
      return start.y + t * (end.y - start.y)
    }
    const from = Math.max(left, segLeft)
    const to = Math.min(right, segRight)
    const y = Math.max(yAt(from), yAt(to))
    low = low == null ? y : Math.max(low, y)
  }
  return low
}

// On a phone, keep the this-season label left of the dot and 4px under the
// line. A label that would leave the plot splits onto two lines under the dot.
function placeSeasonCaption({ compact, caption, name, x, y, points, radius, font, left, bottom }) {
  const cap = font
  if (!compact) {
    let ly = y - 10
    if (ly < cap + 4) ly = Math.min(bottom - 4, y + font + 4)
    return { anchor: 'start', x: x + 10, y: ly, lineH: font + 2, lines: [`${caption}, ${name}`] }
  }
  const gap = 4
  const full = `${caption}, ${name}`
  const width = textWidth(full, font)
  const right = x - radius - gap
  const lineLeft = right - width
  const lineLow = lowestLine(points, lineLeft, right)
  let top = (lineLow == null ? y : lineLow) + gap
  for (const point of points) {
    if (Math.abs(point.x - x) < 0.5 && Math.abs(point.y - y) < 0.5) continue
    if (lineLeft < point.x + radius && right > point.x - radius) {
      top = Math.max(top, point.y + radius + gap)
    }
  }
  const baseline = top + cap
  const fits = lineLeft >= left && baseline + 3 <= bottom
  if (fits) return { anchor: 'end', x: right, y: baseline, lineH: font + 2, lines: [full] }
  const under = y + radius + gap
  let underTop = under
  const narrow = Math.max(textWidth(caption, font), textWidth(name, font))
  const underLeft = x - narrow
  const olderLow = lowestLine(points, underLeft, x)
  if (olderLow != null) underTop = Math.max(underTop, olderLow + gap)
  for (const point of points) {
    if (Math.abs(point.x - x) < 0.5 && Math.abs(point.y - y) < 0.5) continue
    if (underLeft < point.x + radius && x > point.x - radius) {
      underTop = Math.max(underTop, point.y + radius + gap)
    }
  }
  return {
    anchor: 'end',
    x,
    y: underTop + cap,
    lineH: font + 3,
    lines: [caption, name],
  }
}

function showYear(year, compact) {
  if (!compact) return true
  const text = String(year)
  const end = Number(text.includes('-') ? text.split('-').pop() : text)
  return Number.isFinite(end) && end % 4 === 2
}

function eraCopy(compact) {
  return compact ? ['Standards'] : ['Standards era: ', 'no fixed cutoff']
}

// Prefer the bottom of the standards band. A line that would meet a dot moves
// up, and a line wider than the band is compressed so it stays inside it.
function EraLabel({ band, compact, radius, axis, points }) {
  const font = compact ? 11 : 13
  const lines = eraCopy(compact)
  const padX = 4
  const inner = Math.max(8, band.width - padX * 2)
  const widths = lines.map(line => textWidth(line, font))
  const fitted = widths.map(width => Math.min(width, inner))
  const left = band.x + padX
  const right = left + Math.max(...fitted)
  const lineH = font + 3
  const boxH = font + (lines.length - 1) * lineH + 4
  const hits = top => {
    const bottom = top + boxH
    for (const point of points) {
      const nearestX = Math.max(left, Math.min(point.x, right))
      const nearestY = Math.max(top, Math.min(point.y, bottom))
      const dx = point.x - nearestX
      const dy = point.y - nearestY
      if (dx * dx + dy * dy < (radius + 3) ** 2) return true
    }
    return false
  }
  const floor = axis - 4
  let inkTop = null
  for (let top = floor - boxH; top >= band.y + 2; top -= 2) {
    if (!hits(top)) {
      inkTop = top
      break
    }
  }
  if (inkTop == null) inkTop = Math.max(band.y + 2, floor - boxH)
  const baseline = inkTop + font
  return (
    <text className="era" x={left} y={baseline}>
      {lines.map((line, index) => (
        <tspan
          key={line}
          x={left}
          dy={index === 0 ? 0 : lineH}
          {...(widths[index] > inner + 0.5 ? { textLength: inner, lengthAdjust: 'spacingAndGlyphs' } : {})}
        >
          {line}
        </tspan>
      ))}
    </text>
  )
}

function frame(kind, compact) {
  if (compact) {
    const l = kind === 'points' ? 78 : kind === 'mark' ? 66 : 52
    return { W: 360, H: 200, m: { l, r: 8, t: 18, b: 48 }, font: 11, radius: 6 }
  }
  const l = kind === 'points' ? 88 : kind === 'mark' ? 76 : 64
  return { W: 800, H: 300, m: { l, r: 150, t: 26, b: 64 }, font: 14, radius: 4.5 }
}

function YearSvg({ lines, kind, currentYear, compact, name }) {
  const chrono = [...lines].sort((a, b) => a.year.localeCompare(b.year))
  const plotted = chrono.filter(line => Number.isFinite(line.v))
  const { W, H, m, font, radius } = frame(kind, compact)
  const plotH = H - m.t - m.b
  const { ticks, lo, hi } = yearScale(plotted.map(line => line.v), kind)
  const span = hi - lo || 1
  // 10px above the top tick, so the direction label clears it.
  const head = 10
  const yTop = m.t + head
  const yOf = value => yTop + ((kind === 'time' ? value - lo : hi - value) / span) * (plotH - head)
  // 12px from the right edge of a y-axis label to the first season's dot.
  const x0 = m.l + radius + 4
  const x1 = W - m.r
  const xOf = index => (chrono.length === 1 ? (x0 + x1) / 2 : x0 + (index / (chrono.length - 1)) * (x1 - x0))
  const axis = m.t + plotH
  const standards = chrono.map((line, index) => (line.rule === 'standards' ? index : -1)).filter(index => index >= 0)
  let band = null
  if (standards.length) {
    const last = standards[standards.length - 1]
    const edge = last + 1 < chrono.length ? (xOf(last) + xOf(last + 1)) / 2 : xOf(last) + 24
    band = { x: m.l - 8, y: m.t - 4, width: Math.max(12, edge - (m.l - 8)) }
  }
  const segments = []
  let run = []
  chrono.forEach((line, index) => {
    if (line.comparable && Number.isFinite(line.v)) run.push(`${xOf(index).toFixed(1)},${yOf(line.v).toFixed(1)}`)
    else if (run.length) {
      segments.push(run)
      run = []
    }
  })
  if (run.length) segments.push(run)
  const aria = chrono.map(line => {
    const mark = shownMark(line, kind) || 'no mark'
    const phrase = accessibleConversion(line.conversion)
    return `${seasonLabel(line.year)} ${mark}${phrase ? `, ${phrase}` : ''}`
  }).join(', ')
  return (
    <svg className={compact ? 'ph' : 'dk'} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cutoff by season: ${aria}`}>
      {band && <rect className="band" x={band.x} y={m.t - 4} width={band.width} height={plotH + 8} />}
      {band && (
        <EraLabel
          band={band}
          compact={compact}
          radius={radius}
          axis={axis}
          points={plottedPoints(chrono, xOf, yOf)}
        />
      )}
      {ticks.map(value => (
        <g key={value}>
          <line className="grid" x1={m.l} x2={W - m.r} y1={yOf(value)} y2={yOf(value)} />
          <text className="tick" x={m.l - 8} y={yOf(value) + 4} textAnchor="end">{tickLabel(value, kind)}</text>
        </g>
      ))}
      <text className="k" x={m.l - 8} y={compact ? 12 : 16} textAnchor="end">{kind === 'time' ? 'Faster ↑' : 'Better ↑'}</text>
      {segments.filter(points => points.length > 1).map(points => (
        <polyline key={points[0]} className="ln" points={points.join(' ')} />
      ))}
      {chrono.map((line, index) => {
        if (!Number.isFinite(line.v)) return null
        const now = line.year === currentYear
        const hollow = !line.comparable
        return (
          <circle
            key={line.year}
            className={now ? 'now' : hollow ? 'old' : undefined}
            cx={xOf(index)}
            cy={yOf(line.v)}
            r={radius}
          />
        )
      })}
      {chrono.map((line, index) => (
        showYear(line.year, compact) ? (
          <text key={`y-${line.year}`} className="x" x={xOf(index)} y={axis + (compact ? 16 : 18)} textAnchor="middle">
            {yearTick(line.year)}
          </text>
        ) : null
      ))}
      {chrono.map((line, index) => {
        if (line.note !== 'No meet (COVID)' || !Number.isFinite(line.v)) return null
        const x = xOf(index)
        return (
          <g key={`covid-${line.year}`} className="covid">
            <line className="leader" x1={x} x2={x} y1={axis} y2={axis + 6} />
            <text x={x} y={axis + (compact ? 34 : 44)} textAnchor="middle">No meet (COVID)</text>
          </g>
        )
      })}
      {chrono.map((line, index) => {
        if (line.year !== currentYear || !Number.isFinite(line.v)) return null
        const base = shownMark(line, kind)
        const symbols = symbolString(line.conversion)
        const caption = `${base}${symbols}`
        const x = xOf(index)
        const y = yOf(line.v)
        const placed = placeSeasonCaption({
          compact, caption, name, x, y, radius, font,
          points: plottedPoints(chrono, xOf, yOf),
          left: m.l,
          bottom: axis,
        })
        return (
          <g key="now-label" className="now-label">
            {placed.lines.map((text, lineIndex) => (
              <text
                key={text}
                className="now"
                x={placed.x}
                y={placed.y + lineIndex * placed.lineH}
                textAnchor={placed.anchor}
              >
                <SeasonCaption text={text} base={base} symbols={symbols} conversion={line.conversion} />
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function SeasonCaption({ text, base, symbols, conversion }) {
  if (!symbols || !text.startsWith(base)) return text
  const after = text.slice(base.length + symbols.length)
  return <SvgMark mark={base} conversion={conversion} after={after} />
}

function YearChart({ lines, kind, currentYear, name }) {
  const plotted = lines.filter(line => Number.isFinite(line.v))
  if (plotted.length < 2) return null
  return (
    <div className="chart yc">
      <YearSvg lines={lines} kind={kind} currentYear={currentYear} compact={false} name={name} />
      <YearSvg lines={lines} kind={kind} currentYear={currentYear} compact name={name} />
    </div>
  )
}

function Place({ line }) {
  if (line.rule === 'cancelled') return 'Season cancelled'
  if (!line.comparable) {
    return (
      <>
        {ordinal(line.rank)} listed
        <small>not the line</small>
      </>
    )
  }
  return `${ordinal(line.rank)} of ${line.of || line.rank}`
}

function Gap({ line, current, kind, currentYear, selected }) {
  const gap = gapText(line, current, kind, currentYear, selected)
  if (!gap || typeof gap === 'string') return gap
  return (
    <>
      <b>{gap.amount} {gap.word}</b>
      {/* the column head says it beside wide tables; phones hide the heads */}
      <span className="vs">{` than ${selected || 'this season'}`}</span>
    </>
  )
}

// selected names a past season being viewed, which then stands where this season would.
export default function PastYears({ lines, kind, currentYear, selected = null }) {
  const key = lines?.map(line => `${line.year}:${line.rank}`).join('|') || ''
  const [openFor, setOpenFor] = useState(null)
  if (!lines?.length) return null
  const open = openFor === key
  const recent = lines.filter(line => line.rule !== 'standards')
  const standards = lines.filter(line => line.rule === 'standards')
  const hidden = Math.max(0, recent.length - RECENT) + standards.length
  const shownRecent = open ? recent : recent.slice(0, RECENT)
  const shownStandards = open ? standards : []
  const current = lines.find(line => line.comparable && line.year === currentYear)
    || lines.find(line => line.comparable)
    || lines[0]
  const lead = pastSummary(lines, kind, currentYear)
  const firstLine = [...lines].filter(line => line.comparable).sort((a, b) => a.year.localeCompare(b.year))[0]
  const eraLabel = firstLine ? seasonLabel(firstLine.year) : '2012–13'
  const earliest = [...lines].sort((a, b) => a.year.localeCompare(b.year))[0]
  const floor = earliest?.season === 'outdoor' ? '2010' : '2009–10'
  return (
    <div className="past" id="past-years">
      <DetailHero lead={heroLead(lead, current, floor)} stats={heroStats(lead, current, kind, selected)} />
      <section className="detail-box">
        <h3 className="detail-sub">Each season’s cutoff</h3>
        <YearChart lines={lines} kind={kind} currentYear={currentYear} name={selected || 'this season'} />
      </section>
      <section className="detail-box">
        <h3 className="detail-sub">Season by season</h3>
        <table className="past-lines yr">
          <thead>
            <tr>
              <th>Season</th>
              <th>Cutoff</th>
              <th>Place</th>
              <th>Who set it</th>
              <th className="r">{`Compared with ${selected || 'this season'}`}</th>
            </tr>
          </thead>
          <tbody>
            {shownRecent.map(line => (
              <SeasonRow key={`${line.year}-${line.rank}`} line={line} kind={kind} current={current} currentYear={currentYear} selected={selected} />
            ))}
            {shownStandards.length > 0 && (
              <tr className="era">
                <td colSpan={5}>
                  <b>{`Before ${eraLabel} there was no fixed cutoff`}</b>
                  Athletes under the automatic standard were in, and the rest of the field was filled from the list to a size that changed each year (at least 14 in 2010). The 16th-listed mark is shown for reference and isn’t compared.
                </td>
              </tr>
            )}
            {shownStandards.map(line => (
              <SeasonRow key={`${line.year}-${line.rank}`} line={line} kind={kind} current={current} currentYear={currentYear} selected={selected} old />
            ))}
          </tbody>
        </table>
        {hidden > 0 && (
          <button
            type="button"
            className="more"
            aria-expanded={open}
            aria-controls="past-years"
            onClick={() => setOpenFor(open ? null : key)}
          >
            {open ? 'Show recent seasons' : `Show all ${lines.length} seasons`}
          </button>
        )}
      </section>
      <p className="note">
        {`Past seasons are final lists only, so there’s no day-by-day chart for them. TFRRS has no Division I lists before ${floor}.`}
      </p>
    </div>
  )
}

function heroLead(lead, current, floor) {
  const field = lead?.field || current?.of || current?.rank
  return `The cutoff for a top-${field} field on each season’s final list, back to ${floor}.`
}

// This season's cutoff, where it ranks, and how far it has come since the first fixed field.
function heroStats(lead, current, kind, selected) {
  const stats = []
  if (current && Number.isFinite(current.v)) {
    stats.push({
      label: selected || (lead && !lead.currentIsNow ? 'Latest saved' : 'This season'),
      value: <Mark text={shownMark(current, kind)} conversion={current.conversion} raw={current.raw} />,
      accent: true,
    })
  }
  if (!lead) return stats
  stats.push({ label: `Among ${lead.count} seasons`, value: lead.phrase.charAt(0).toUpperCase() + lead.phrase.slice(1) })
  if (lead.change) stats.push({ label: `Since ${lead.change.year}`, value: `${lead.change.amount} ${lead.change.word}` })
  if (lead.best) {
    stats.push({ label: `${lead.bestWord.charAt(0).toUpperCase()}${lead.bestWord.slice(1)}, ${seasonLabel(lead.best.year)}`, value: <Mark text={shownMark(lead.best, kind)} conversion={lead.best.conversion} raw={lead.best.raw} /> })
  }
  return stats
}

function SeasonRow({ line, kind, current, currentYear, selected, old = false }) {
  const now = line.comparable && line.year === currentYear
  const converted = conversionCopy(line)
  const note = meetNote(line)
  const pile = pileSentence(line)
  const field = fieldNote(line, kind)
  return (
    <tr className={now ? 'now' : old ? 'old' : undefined}>
      <td className="s">{seasonLabel(line.year)}</td>
      <td className="t">{shownMark(line, kind) ? <Mark text={shownMark(line, kind)} conversion={line.conversion} raw={line.raw} hang /> : '—'}</td>
      <td className="pl2"><Place line={line} /></td>
      <td className="who">
        <span className="who-name">{line.team && <Logo team={line.team} />}{atLine(line)}</span>
        {quietLines(line.conversion).map(text => <span className="quiet" key={text}>{text}</span>)}
        {line.raw ? <span className="quiet">{`Raw mark: ${line.raw}`}</span> : null}
        {pile && <span className="tie">{pile}<Mark text={shownMark(line, kind)} conversion={line.conversion} raw={line.raw} /></span>}
        {line.tie && !pile && <span className="tie">{tieSentence(line.tie)}</span>}
        {field && <span className="fld">{field}</span>}
        {note && <span className="tie">{note}</span>}
        {!line.conversion && converted && <span className="conv">{converted}</span>}
      </td>
      <td className="d"><Gap line={line} current={current} kind={kind} currentYear={currentYear} selected={selected} /></td>
    </tr>
  )
}

// The card's small picture: one dot a season, this season's in the accent.
export function YearSpark({ lines, kind, currentYear, width = 120, height = 24 }) {
  const chrono = [...lines].filter(line => line.comparable && Number.isFinite(line.v)).sort((a, b) => a.year.localeCompare(b.year))
  if (chrono.length < 2) return null
  const values = chrono.map(line => line.v)
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const x = index => 3 + (index / (chrono.length - 1)) * (width - 6)
  const y = value => 3 + (kind === 'time' ? (value - min) / span : 1 - (value - min) / span) * (height - 6)
  return (
    <svg className="spark yspark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={chrono.map((line, index) => `${x(index).toFixed(1)},${y(line.v).toFixed(1)}`).join(' ')} fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.25" strokeLinejoin="round" />
      {chrono.map((line, index) => (
        <circle key={line.year} className={line.year === currentYear ? 'now' : undefined} cx={x(index)} cy={y(line.v)} r={line.year === currentYear ? 3 : 1.75} fill="currentColor" />
      ))}
    </svg>
  )
}
