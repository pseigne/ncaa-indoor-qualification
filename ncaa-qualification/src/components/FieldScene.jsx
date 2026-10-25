import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CHIP, CHIP_PHONE } from '../utils/chips'
import { layoutScene, sceneHeight, sceneReadout } from '../utils/scene'
import { canvasMeasure } from '../utils/strip'
import LogoChip from './LogoChip'
import { FieldTag } from './RaceStrip'

// A jump or a throw drawn on its own venue. Upright beside the table on wide screens, where it sizes itself
// from the rail like the race column; flat in the card everywhere else.
export default function FieldScene({
  scene, rows, scale, lineRank, fieldRank = null, rail = false, width = 0, phone = false, listed,
  activeRank, onHover, onLeave, chip, onChip, caption,
}) {
  const boxRef = useRef(null)
  const svgRef = useRef(null)
  const [size, setSize] = useState(null)
  const measure = useMemo(() => canvasMeasure(), [])
  const lineV = rows.find(row => row.rank === lineRank)?.v

  // The rail reports its whole plot box; the card only its width, so the venue is drawn at the size it shows.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return undefined
    const report = () => {
      const next = { width: Math.floor(box.clientWidth), height: Math.floor(box.clientHeight) }
      if (next.width > 0 && (next.height > 0 || !rail)) setSize(prev => (prev && prev.width === next.width && prev.height === next.height ? prev : next))
    }
    report()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(report)
    observer.observe(box)
    return () => observer.disconnect()
  }, [rail])

  const W = size?.width || (rail ? null : width)
  const H = rail ? size?.height : W ? sceneHeight(scene, W) : null
  const layout = useMemo(() => (W && H ? layoutScene({
    scene,
    rows,
    lineV,
    rank: lineRank,
    fieldRank,
    scale,
    width: W,
    height: H,
    upright: rail,
    radius: rail ? 5 : phone ? 4.5 : 6,
    chipR: phone ? CHIP_PHONE : CHIP,
    measure,
    listed,
  }) : null), [scene, rows, lineV, lineRank, fieldRank, scale, W, H, rail, phone, measure, listed])

  const active = layout?.placed.find(dot => dot.rank === activeRank) || null
  const readout = active ? sceneReadout(layout, active, lineRank) : null

  const pick = event => {
    if (!layout) return
    const bounds = svgRef.current.getBoundingClientRect()
    const x = (event.clientX - bounds.left) * layout.width / (bounds.width || layout.width)
    const y = (event.clientY - bounds.top) * layout.height / (bounds.height || layout.height)
    let best = null
    layout.placed.forEach(dot => {
      const d = Math.hypot(dot.x - x, dot.y - y)
      if (d < Math.max(12, dot.rr + 4) && (!best || d < best.d)) best = { dot, d }
    })
    return best ? best.dot.rank : null
  }

  const svg = layout && (
    <svg
      ref={svgRef}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={layout.aria}
      onPointerMove={event => { if (event.pointerType === 'mouse') onHover?.(pick(event)) }}
      onPointerDown={event => { if (event.pointerType !== 'mouse') onHover?.(pick(event)) }}
    >
      <g className="venue">
        {layout.deco.map((item, index) => {
          if (item.kind === 'rect') return <rect key={index} className={item.cls} x={item.x} y={item.y} width={item.w} height={item.h} rx={item.rx} />
          if (item.kind === 'circle') return <circle key={index} className={item.cls} cx={item.cx} cy={item.cy} r={item.r} />
          return <path key={index} className={item.cls} d={item.d} />
        })}
      </g>
      {layout.ticks.map(tick => <path key={tick.v} className="gauge" d={tick.path} />)}
      {layout.ticks.map(tick => <text key={tick.v} className="tick" x={tick.x} y={tick.y} textAnchor={tick.anchor}>{tick.text}</text>)}
      {layout.field && (
        <g className="fld-l">
          <path d={layout.field.path} />
          <FieldTag x={layout.field.tag.x0} y={layout.field.tag.y0} />
        </g>
      )}
      <g className={`fl${scene === 'bar' || scene === 'vault' ? ' bar' : ''}`}>
        <path d={layout.line.path} />
        {(scene === 'bar' || scene === 'vault') && <path className="stripe" d={layout.line.path} />}
      </g>
      {[...layout.placed].reverse().map(dot => {
        const cls = dot.rank === lineRank ? 'bub' : dot.rank < lineRank ? 'in' : 'out'
        const leader = dot.rank === 1
        return (
          <g
            key={`${dot.name}:${dot.rank}`}
            className={`dot ${cls}${dot.rank === activeRank ? ' on' : ''}${leader ? ' chipdot' : ''}`}
            data-rank={dot.rank}
            transform={`translate(${dot.x} ${dot.y})`}
          >
            {leader
              ? <LogoChip team={dot.team || dot.name} r={dot.rr} outline={cls === 'out'} />
              : <circle className="pt" r={cls === 'out' ? layout.radius - 0.75 : layout.radius} />}
            <circle className="hl" r={dot.rr + 3} />
          </g>
        )
      })}
      <g className="labels">
        <Label box={layout.line.label} />
        {layout.leaderLabel && <Label box={layout.leaderLabel} />}
      </g>
      {readout && (
        <text className="k halo readout" x={readout.x} y={readout.y} textAnchor={readout.anchor} data-rank={active.rank}>{readout.text}</text>
      )}
    </svg>
  )

  if (rail) {
    return (
      <aside className="rail" onPointerLeave={onLeave}>
        <figure className={`race column scene${readout ? ' reading' : ''}`} id="race" data-scene={scene}>
          <div className="plot" ref={boxRef}>
            {svg}
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
  return (
    <figure className={`race card scene${readout ? ' reading' : ''}`} data-scene={scene} onPointerLeave={() => onHover?.(null)}>
      <div className="flat" ref={boxRef}>{svg}</div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

function Label({ box }) {
  return (
    <text textAnchor={box.anchor} className="halo">
      {box.lines.map((line, index) => (
        <tspan key={line.text} className={line.cls} x={box.x} y={box.y + index * 17}>{line.text}</tspan>
      ))}
    </text>
  )
}
