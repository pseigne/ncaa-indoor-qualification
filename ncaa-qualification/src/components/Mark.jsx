import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { FLAG_COPY, FLAG_LABEL, symbolString, symbolsFor } from '../utils/format'

export function Mark({ text, conversion, raw = null, interactive = true, hang = false }) {
  const symbols = symbolsFor(conversion)
  if (!symbols.length && !hang) return text
  const flags = symbols.length
    ? (interactive ? <FlagButton symbols={symbols} raw={raw} /> : symbols.map(symbol => <FlagGlyph key={symbol} symbol={symbol} />))
    : null
  if (!hang) return <>{text}{flags}</>
  return (
    <span className="mk">
      <span className="mk-n">{text}</span>
      <span className="mk-slot">{flags}</span>
    </span>
  )
}

export function SvgMark({ before = '', mark = '', conversion, after = '' }) {
  const symbols = symbolString(conversion)
  return (
    <>
      {before}{mark}
      {symbols ? <tspan className="sym" dy="-0.35em">{symbols}</tspan> : null}
      {after ? <tspan dy={symbols ? '0.35em' : undefined}>{after}</tspan> : null}
    </>
  )
}

function FlagGlyph({ symbol }) {
  return (
    <span className="sym">
      <span aria-hidden="true">{symbol}</span>
      <span className="vh">{FLAG_LABEL[symbol]}</span>
    </span>
  )
}

function placePanel(anchor, panel) {
  const pad = 12
  const gap = 6
  const symbol = anchor.querySelector('.sym-btn') || anchor
  const host = anchor.getBoundingClientRect()
  const mark = symbol.getBoundingClientRect()
  let top = mark.bottom - host.top + gap
  const left = mark.left - host.left
  panel.style.top = `${top}px`
  panel.style.left = `${left}px`
  let box = panel.getBoundingClientRect()
  if (box.bottom > window.innerHeight - pad && mark.top - box.height - gap >= pad) {
    top = mark.top - host.top - box.height - gap
    panel.style.top = `${top}px`
    box = panel.getBoundingClientRect()
  }
  // Keep the panel inside the table's own column. Beside the pinned race strip, a panel opened near
  // the table's right edge used to spill over the strip and sit on its labels and dots.
  const column = anchor.closest('.split-sheet')?.getBoundingClientRect()
  const right = Math.min(window.innerWidth - pad, column ? column.right : Infinity)
  const leftmost = Math.max(pad, column ? column.left : -Infinity)
  let shift = 0
  if (box.right > right) shift = right - box.right
  if (box.left + shift < leftmost) shift = leftmost - box.left
  panel.style.left = `${left + shift}px`
}

function FlagButton({ symbols, raw }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const panelRef = useRef(null)
  const id = useId()
  useLayoutEffect(() => {
    const anchor = ref.current
    const panel = panelRef.current
    if (!open || !anchor || !panel) return undefined
    const place = () => placePanel(anchor, panel)
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  useEffect(() => {
    if (!open) return undefined
    const onDoc = event => {
      const target = event.target
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const label = symbols.map(symbol => FLAG_LABEL[symbol]).join(', ')
  return (
    <span className={`flag${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="sym-btn"
        aria-expanded={open}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(value => !value)}
      >
        {symbols.map(symbol => <span key={symbol} aria-hidden="true">{symbol}</span>)}
      </button>
      {open && (
        <span className="pop" id={id} role="note" ref={panelRef}>
          {symbols.map(symbol => (
            <span key={symbol}>
              <span className="sym">{symbol}</span>
              {` ${FLAG_COPY[symbol]}`}
            </span>
          ))}
          {raw ? <span>{`Raw mark: ${raw}.`}</span> : null}
        </span>
      )}
    </span>
  )
}
