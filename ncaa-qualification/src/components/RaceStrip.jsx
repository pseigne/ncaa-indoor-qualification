import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { formatMark, symbolString } from '../utils/format'
import {
  FIELD_TAG, canvasMeasure, fieldMeters, fitReadout, formatMeters, readoutNames,
} from '../utils/strip'
import { useReduceMotion } from '../utils/media'
import { chipCentre, chipDots, chipRadius, chipsLast, coveredDots, liftedDot } from '../utils/chips'
import LogoChip from './LogoChip'

function dotKey(dot, counts) {
  if (!dot.name || counts[dot.name] > 1) return `${dot.name}:${dot.rank}`
  return dot.name
}

export default function RaceStrip({
  layout, caption, kind, lineRank, fieldRank = null, activeRank, onHover, memory, runKey, glide = false, fit = false, card = false, phone = false, scrollRank = null,
}) {
  const svgRef = useRef(null)
  const previous = useRef(new Map())
  const ready = useRef(false)
  const reduce = useReduceMotion()
  const measureText = useMemo(() => canvasMeasure(), [])
  const active = layout?.placed.find(dot => dot.rank === activeRank) || null
  const fitted = active && !memory ? fitActive(active, layout, kind, lineRank, measureText) : null
  const readout = memory?.text || fitted?.readout || ''
  const readoutX = memory ? memory.x : fitted ? fitted.x : 0
  const anchor = memory ? memory.anchor : fitted ? fitted.anchor : 'middle'

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !runKey || glide || reduce) return undefined
    try {
      if (sessionStorage.getItem(runKey)) return undefined
      sessionStorage.setItem(runKey, '1')
    } catch { return undefined }
    const dots = [...svg.querySelectorAll('.dot')]
    dots.forEach(dot => {
      dot.style.transition = 'none'
      dot.dataset.to = dot.style.transform
      dot.style.transform = dot.style.transform.replace(/translate\(([-\d.]+)px/, 'translate(-24px')
    })
    svg.getBoundingClientRect()
    dots.forEach((dot, index) => {
      dot.style.transition = `transform var(--run) var(--ease) ${index * 8}ms`
      dot.style.transform = dot.dataset.to
    })
    return undefined
  }, [runKey, glide, reduce, layout])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg || !fit) return undefined
    const dots = [...svg.querySelectorAll('.dot')]
    if (!glide || !ready.current) {
      dots.forEach(dot => { dot.style.transition = 'none' })
      const id = requestAnimationFrame(() => {
        dots.forEach(dot => previous.current.set(dot.dataset.key, dot.style.transform))
        ready.current = true
      })
      return () => cancelAnimationFrame(id)
    }
    dots.forEach(dot => {
      const next = dot.style.transform
      const old = previous.current.get(dot.dataset.key)
      if (old && old !== next && !reduce) {
        dot.style.transition = 'none'
        dot.style.transform = old
      }
      previous.current.set(dot.dataset.key, next)
    })
    const id = requestAnimationFrame(() => {
      dots.forEach(dot => {
        const next = previous.current.get(dot.dataset.key)
        if (!reduce) dot.style.transition = 'transform 420ms var(--ease)'
        if (next && dot.style.transform !== next) dot.style.transform = next
      })
    })
    return () => cancelAnimationFrame(id)
  }, [fit, glide, layout, reduce])

  if (!layout) return null
  const chips = card ? chipDots(layout.placed, lineRank, fieldRank) : []
  // The row picked by scrolling lifts its runner's dot into a chip, drawn after everything else.
  const lifted = card ? liftedDot(layout.placed, scrollRank, chips) : null
  const drawn = lifted ? [...chips, lifted] : chips
  // Ahead is to the right on the strip.
  const chipX = dot => chipCentre(dot.x, layout.lineX, dot.rank > lineRank ? -1 : dot.rank < lineRank ? 1 : 0, {
    r: chipRadius(phone), outline: dot.rank > lineRank, dotRadius: layout.radius,
  })
  const under = coveredDots(layout.placed, drawn.map(dot => ({
    dot, x: chipX(dot), y: dot.y, reach: chipRadius(phone) + (dot.rank > lineRank ? 3 : 0),
  })), layout.radius)
  const drawnX = rank => {
    const chip = chips.find(dot => dot.rank === rank)
    return chip ? chipX(chip) : null
  }
  const fieldM = fieldRank == null ? null : fieldMeters(layout.placed, fieldRank)
  const fieldX = fieldM == null ? null : layout.xAt(fieldM)
  const tagX = fieldX == null ? null : fieldTagX(layout, fieldX)
  const counts = {}
  layout.placed.forEach(dot => { counts[dot.name] = (counts[dot.name] || 0) + 1 })
  const near = event => {
    const bounds = svgRef.current.getBoundingClientRect()
    const x = (event.clientX - bounds.left) * layout.width / bounds.width
    let best = null
    layout.placed.forEach(dot => {
      const dx = Math.abs(dot.x - x)
      if (dx < 14 && (!best || dx < best.dx)) best = { dot, dx }
    })
    onHover?.(best ? best.dot.rank : null)
  }

  return (
    <figure className={`race${card ? ' card' : ''}${fit ? ' fit' : ''}${glide ? ' glide' : ''}${readout ? ' reading' : ''}`} id="race">
      <svg
        ref={svgRef}
        viewBox={`0 ${layout.viewY} ${layout.width} ${layout.viewHeight}`}
        role="img"
        aria-label={layout.aria}
        onPointerMove={event => { if (event.pointerType === 'mouse') near(event) }}
        onPointerLeave={() => onHover?.(null)}
      >
        {layout.lanes.map(lane => (
          <line key={lane.y} className="lane" shapeRendering="crispEdges" x1={lane.x1} x2={lane.x2} y1={lane.y} y2={lane.y} />
        ))}
        {layout.ticks.map(tick => (
          <text key={tick.text} x={tick.x} y={layout.axisY} textAnchor="middle">{tick.text}</text>
        ))}
        {layout.ends.map(end => (
          <text key={end.text} x={end.x} y={layout.axisY} textAnchor={end.anchor}>{end.text}</text>
        ))}
        <g className="labels">
          {layout.labels.map(label => (
            <g key={label.text}>
              {label.leader && (
                <line className="lead-l" x1={drawnX(label.rank) ?? label.leader.x1} x2={drawnX(label.rank) ?? label.leader.x2} y1={label.leader.y1} y2={label.leader.y2} />
              )}
              {label.id === 'line' && label.anchor === 'end'
                ? <text className={label.cls} x={label.x1} y={label.y} textAnchor="end">{label.text}</text>
                : <text className={label.cls} x={label.x0} y={label.y}>{label.text}</text>}
            </g>
          ))}
        </g>
        <text className="k readout" y={layout.readoutY} x={readoutX} textAnchor={anchor} opacity={readout ? 1 : 0}>
          {typeof readout === 'string' ? readout : (
            <>
              {readout.head}{readout.mark}
              {symbolString(readout.conversion)
                ? <tspan className="sym" dy="-0.35em">{symbolString(readout.conversion)}</tspan>
                : null}
              {symbolString(readout.conversion)
                ? <tspan dy="0.35em">{readout.tail}</tspan>
                : readout.tail}
            </>
          )}
        </text>
        <g className="fl">
          <line x1={layout.lineX} x2={layout.lineX} y1={layout.top - 10} y2={layout.baseY + layout.lane / 2 + 5} />
        </g>
        {fieldX != null && (
          <g className="fld-l">
            <line x1={fieldX} x2={fieldX} y1={layout.top - 10} y2={layout.baseY + layout.lane / 2 + 5} />
            <FieldTag x={tagX} y={layout.top - 9} />
          </g>
        )}
        {chipsLast(layout.placed, drawn).map(dot => {
          const cls = dot.rank === lineRank ? 'bub' : dot.rank < lineRank ? 'in' : 'out'
          const r = cls === 'out' ? layout.radius - 0.75 : layout.radius
          const chip = drawn.includes(dot)
          const chipR = chip ? chipRadius(phone) : 0
          return (
            <g
              key={dotKey(dot, counts)}
              className={`dot ${cls}${dot.rank === activeRank ? ' on' : ''}${chip ? ' chipdot' : ''}${dot === lifted ? ' scrollchip' : ''}${under.has(dot) ? ' under' : ''}`}
              data-rank={dot.rank}
              data-key={dotKey(dot, counts)}
              style={{ transform: `translate(${chip ? chipX(dot) : dot.x}px, ${dot.y}px)` }}
            >
              {dot === lifted ? (
                <g className="chip-in" key="lifted"><LogoChip team={dot.team || dot.name} r={chipR} outline={cls === 'out'} /></g>
              ) : chip ? <LogoChip team={dot.team || dot.name} r={chipR} outline={cls === 'out'} /> : <circle className="pt" r={r} />}
              <circle className="hl" r={chip ? chipR + (cls === 'out' ? 5 : 3) : layout.radius + 3} />
            </g>
          )
        })}
      </svg>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

// The field line's name on a small blue tab, so it reads on the track.
export function FieldTag({ x, y }) {
  return (
    <g className="fld-tag" transform={`translate(${x} ${y})`}>
      <rect width={FIELD_TAG.w} height={FIELD_TAG.h} rx={FIELD_TAG.h / 2} />
      <text x={FIELD_TAG.w / 2} y="13" textAnchor="middle">Field line</text>
    </g>
  )
}

// The field line's tag sits in the top label row, beside the line: on the side away from the qualifying
// line where it fits, and clear of any label in that row.
function fieldTagX(layout, fieldX) {
  const w = FIELD_TAG.w
  const row = layout.labels.filter(label => Math.abs(label.y - (layout.top + 4)) < 10)
  const away = fieldX < layout.lineX ? [fieldX - w - 6, fieldX + 6] : [fieldX + 6, fieldX - w - 6]
  const fits = x => x >= 0 && x + w <= layout.width
    && !(x < layout.lineX + 4 && x + w > layout.lineX - 4)
    && row.every(label => x + w + 8 < label.x0 || x - 8 > label.x1)
  return away.find(fits) ?? away.find(x => x >= 0 && x + w <= layout.width) ?? Math.max(0, fieldX - w - 6)
}

// The readout for the dot being pointed at, fitted inside the strip: a shorter name, the other side of the
// dot, and only then fewer parts. Never cut off.
function fitActive(dot, { width, scale }, kind, lineRank, measure) {
  const mark = formatMark(dot.v, kind)
  const sym = symbolString(dot.conversion)
  const tail = ` · ${dot.rank === lineRank ? 'on the line' : `${formatMeters(dot.m, scale.digits)} ${dot.m > 0 ? scale.ahead : scale.back}`}`
  const head = name => `${dot.rank}. ${name}`
  const parts = (name, keep) => `${head(name)}${keep.mark ? ` · ${mark}${sym}` : ''}${keep.tail ? tail : ''}`
  const names = readoutNames(dot.name)
  const fit = fitReadout({
    x: dot.x, width, names: names.length ? names : [`Place ${dot.rank}`], parts,
    measure: text => (measure ? measure(text, true) : text.length * 7.6),
  })
  return {
    x: fit.x,
    anchor: fit.anchor,
    readout: {
      head: `${head(fit.name)}${fit.mark ? ' · ' : ''}`,
      mark: fit.mark ? mark : '',
      conversion: fit.mark ? dot.conversion : null,
      tail: fit.tail ? tail : '',
    },
  }
}
