import { useLayoutEffect, useRef } from 'react'
import { chipCentre, chipDots, chipRadius, chipsLast, coveredDots } from '../utils/chips'
import { fieldMeters, placeReadout } from '../utils/strip'
import LogoChip from './LogoChip'
import { FieldTag } from './RaceStrip'

// The race strip stood upright beside the table on wide screens. The page owns the layout;
// this reports the space it has, draws the field and points back at rows that are off screen.
export default function RaceColumn({
  layout, kind, lineRank, fieldRank = null, activeRank, onHover, onLeave, onSize, memory, seen, chip, onChip, caption, style,
}) {
  const boxRef = useRef(null)
  const svgRef = useRef(null)
  const sizeRef = useRef(onSize)

  useLayoutEffect(() => { sizeRef.current = onSize })

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return undefined
    const report = () => {
      const width = Math.floor(box.clientWidth)
      const height = Math.floor(box.clientHeight)
      if (width > 0 && height > 0) sizeRef.current?.({ width, height })
    }
    report()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(report)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const near = event => {
    if (!layout || event.pointerType !== 'mouse') return
    const bounds = svgRef.current.getBoundingClientRect()
    const x = (event.clientX - bounds.left) * layout.width / (bounds.width || layout.width)
    const y = (event.clientY - bounds.top) * layout.height / (bounds.height || layout.height)
    let best = null
    layout.placed.forEach(dot => {
      const d = Math.hypot((dot.x - x) * 0.6, dot.y - y)
      if (d < 14 && (!best || d < best.d)) best = { dot, d }
    })
    onHover?.(best ? best.dot.rank : null)
  }

  const active = layout?.placed.find(dot => dot.rank === activeRank) || null
  const readout = active && !memory ? placeReadout(layout, active, kind, lineRank) : null
  const band = layout && seen ? bandFor(layout, seen) : null
  const fieldM = layout && fieldRank != null ? fieldMeters(layout.placed, fieldRank) : null
  const fieldY = fieldM == null ? null : layout.yAt(fieldM)
  const chips = layout ? chipDots(layout.placed, lineRank) : []
  const chipR = chipRadius()
  // Ahead is up the column, so the first one out's chip stays below the line and the leader's above it.
  const chipY = dot => chipCentre(dot.y, layout.lineY, dot.rank > lineRank ? 1 : dot.rank < lineRank ? -1 : 0, {
    r: chipR, outline: dot.rank > lineRank, dotRadius: layout.radius,
  })
  const under = layout ? coveredDots(layout.placed, chips.map(dot => ({
    dot, x: dot.x, y: chipY(dot), reach: chipR + (dot.rank > lineRank ? 3 : 0),
  })), layout.radius) : new Set()

  return (
    <aside className="rail" style={style} onPointerLeave={onLeave}>
      <figure className={`race column${readout || memory ? ' reading' : ''}`} id="race">
        <div className="plot" ref={boxRef}>
          {layout && (
            <svg
              ref={svgRef}
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label={layout.aria}
              onPointerMove={near}
            >
              {band && <rect className="seen" x={layout.laneFrom} width={layout.laneTo - layout.laneFrom} y={band.y} height={band.h} rx="4" />}
              {layout.lanes.map(lane => (
                <line key={lane.x} className="lane" shapeRendering="crispEdges" x1={lane.x} x2={lane.x} y1={lane.y1} y2={lane.y2} />
              ))}
              {layout.ticks.map(tick => (
                <text key={tick.text} x={0} y={tick.y + 5}>{tick.text}</text>
              ))}
              {layout.ends.map(end => (
                <text key={end.text} x={0} y={end.y}>{end.text}</text>
              ))}
              <g className="fl">
                <line x1={0} x2={layout.width} y1={layout.lineY} y2={layout.lineY} />
              </g>
              {fieldY != null && (
                <g className="fld-l">
                  <line className="under" x1={layout.laneFrom} x2={layout.width} y1={fieldY} y2={fieldY} />
                  <line x1={layout.laneFrom} x2={layout.width} y1={fieldY} y2={fieldY} />
                  <FieldTag x={layout.width - 66} y={fieldY > layout.lineY ? fieldY + 5 : fieldY - 23} />
                </g>
              )}
              <g className="labels leads">
                {layout.labels.map(label => (
                  <polyline key={label.rank} className="lead-l" points={leaderFrom(label, chips, chipY).join(' ')} data-rank={label.rank} />
                ))}
              </g>
              {readout?.leader && (
                <polyline className="lead-l readout-l" points={readout.leader.points.join(' ')} />
              )}
              {chipsLast(layout.placed, chips).map(dot => {
                const cls = dot.rank === lineRank ? 'bub' : dot.rank < lineRank ? 'in' : 'out'
                const r = cls === 'out' ? layout.radius - 0.75 : layout.radius
                const chip = chips.includes(dot)
                return (
                  <g
                    key={`${dot.name}:${dot.rank}`}
                    className={`dot ${cls}${dot.rank === activeRank ? ' on' : ''}${chip ? ' chipdot' : ''}${under.has(dot) ? ' under' : ''}`}
                    data-rank={dot.rank}
                    style={{ transform: `translate(${dot.x}px, ${chip ? chipY(dot) : dot.y}px)` }}
                  >
                    {chip ? <LogoChip team={dot.team || dot.name} r={chipR} outline={cls === 'out'} /> : <circle className="pt" r={r} />}
                    <circle className="hl" r={chip ? chipR + (cls === 'out' ? 5 : 3) : layout.radius + 3} />
                  </g>
                )
              })}
              <g className="labels">
                {layout.labels.map(label => (
                  <text key={label.rank} className={`${label.cls}${label.halo ? ' halo' : ''}`} textAnchor={label.anchor} data-rank={label.rank}>
                    {label.lines.map((line, index) => (
                      <tspan key={line} x={label.x} y={label.y0 + 13 + index * 17}>{line}</tspan>
                    ))}
                  </text>
                ))}
              </g>
              <text className={`a line-label${layout.lineLabel.halo ? ' halo' : ''}`} textAnchor="end">
                {layout.lineLabel.lines.map((line, index) => (
                  <tspan key={line} x={layout.lineLabel.x} y={layout.lineLabel.y0 + 13 + index * 17}>{line}</tspan>
                ))}
              </text>
              {memory && (
                <text className="k halo memory" textAnchor="end">
                  {memory.lines.map((line, index) => (
                    <tspan key={line} x={layout.width} y={memory.y + index * 17}>{line}</tspan>
                  ))}
                </text>
              )}
              {readout && (
                <text className="k halo readout" textAnchor={readout.anchor} data-rank={active.rank}>
                  {readout.lines.map((line, index) => (
                    <tspan key={index} className={index ? 'r2' : undefined} x={readout.x} y={readout.y + index * 17}>
                      {line.mark != null ? (
                        <>
                          {line.mark}
                          {line.sym ? <tspan className="sym" dy="-0.35em">{line.sym}</tspan> : null}
                          {line.tail ? <tspan dy={line.sym ? '0.35em' : undefined}>{line.tail}</tspan> : null}
                        </>
                      ) : line.text}
                    </tspan>
                  ))}
                </text>
              )}
            </svg>
          )}
          {chip && (
            <button type="button" className="chip press" onClick={onChip} aria-label={`Show ${chip.text} in the table`}>
              {chip.text} <span aria-hidden="true">{chip.down ? '↓' : '↑'}</span>
            </button>
          )}
        </div>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    </aside>
  )
}

function bandFor(layout, seen) {
  const shown = layout.placed.filter(dot => dot.rank >= seen.lo && dot.rank <= seen.hi)
  if (!shown.length) return null
  const pad = layout.radius + 4
  const top = Math.min(...shown.map(dot => dot.y)) - pad
  const bottom = Math.max(...shown.map(dot => dot.y)) + pad
  return { y: top, h: bottom - top }
}

// A chip drawn clear of the line starts its leader where it is drawn, then joins the routed path.
function leaderFrom(label, chips, chipY) {
  const dot = chips.find(chip => chip.rank === label.rank)
  const y = dot ? chipY(dot) : null
  return dot && y !== dot.y ? [[dot.x, y], ...label.leader.points] : label.leader.points
}
