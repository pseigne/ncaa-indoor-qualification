import { useEffect, useId, useRef } from 'react'
import { focusHeading, trapTab } from '../utils/focus'
import { usePhone, useReduceMotion } from '../utils/media'

const CROSS = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

// A dialog over the event page, built like it: a dark head like the hero card, then white cards on the
// page's ground. The URL holds it open, so it can be linked to and Back closes it. Closed by Escape,
// Close, a click outside or Back: focus goes back to the card that opens it. On phones it is a sheet
// from the bottom edge: it slides away when closed, and a drag down from its top lets it go.
export default function DetailSheet({ name, eyebrow, title, onClose, children }) {
  const ref = useRef(null)
  const id = useId()
  const phone = usePhone()
  const reduce = useReduceMotion()
  const leaving = useRef(0)
  const dismiss = () => {
    const dialog = ref.current
    if (leaving.current) return
    if (!phone || reduce || !dialog) {
      onClose()
      return
    }
    dialog.style.transform = ''
    dialog.classList.add('leaving')
    leaving.current = setTimeout(onClose, 220)
  }
  // The latest dismiss, for the touch handlers set up once per sheet.
  const dismissRef = useRef(dismiss)
  useEffect(() => { dismissRef.current = dismiss })
  useEffect(() => () => clearTimeout(leaving.current), [])

  // A drag that starts with the sheet scrolled to its top moves the sheet instead of its content. Let go
  // past a quarter of it, or with a flick, and it closes; short of that it settles back.
  useEffect(() => {
    const dialog = ref.current
    if (!phone || !dialog) return undefined
    let drag = null
    const onStart = touch => {
      if (touch.touches.length !== 1) return
      drag = { y: touch.touches[0].clientY, t: touch.timeStamp, top: dialog.scrollTop <= 0, dy: 0, on: false }
    }
    const onMove = touch => {
      if (!drag) return
      const dy = touch.touches[0].clientY - drag.y
      if (!drag.on) {
        if (!drag.top || dy < 0) {
          if (Math.abs(dy) > 6) drag = null
          return
        }
        if (dy < 4) return
        drag.on = true
      }
      touch.preventDefault()
      drag.dy = Math.max(0, dy)
      dialog.style.transition = 'none'
      dialog.style.transform = `translateY(${drag.dy}px)`
    }
    const onEnd = touch => {
      const done = drag
      drag = null
      if (!done?.on) return
      dialog.style.transition = ''
      const speed = done.dy / Math.max(1, touch.timeStamp - done.t)
      if (done.dy > Math.min(160, dialog.offsetHeight / 4) || speed > 0.6) dismissRef.current()
      else dialog.style.transform = ''
    }
    dialog.addEventListener('touchstart', onStart, { passive: true })
    dialog.addEventListener('touchmove', onMove, { passive: false })
    dialog.addEventListener('touchend', onEnd)
    dialog.addEventListener('touchcancel', onEnd)
    return () => {
      dialog.removeEventListener('touchstart', onStart)
      dialog.removeEventListener('touchmove', onMove)
      dialog.removeEventListener('touchend', onEnd)
      dialog.removeEventListener('touchcancel', onEnd)
    }
  }, [phone])
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return undefined
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    dialog.querySelector('.close')?.focus()
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      // After the page under the dialog has rendered again.
      requestAnimationFrame(() => {
        const card = document.querySelector(`[data-detail="${name}"]`)
        if (card) card.focus()
        else focusHeading()
      })
    }
  }, [name])
  const onKeyDown = key => {
    if (key.key === 'Escape') {
      key.preventDefault()
      dismiss()
      return
    }
    trapTab(key, ref.current)
  }
  return (
    <dialog
      ref={ref}
      className="sheet detail"
      aria-labelledby={`${id}-e ${id}-t`}
      onCancel={cancel => { cancel.preventDefault(); dismiss() }}
      onKeyDown={onKeyDown}
      onClick={click => { if (click.target === ref.current) dismiss() }}
    >
      <div className="detail-head">
        <span className="grab" aria-hidden="true" />
        <div>
          <p className="detail-eyebrow" id={`${id}-e`}>{eyebrow}</p>
          <h2 id={`${id}-t`}>{title}</h2>
        </div>
        <button type="button" className="press close" onClick={dismiss}>{CROSS}Close</button>
      </div>
      <div className="detail-body">{children}</div>
    </dialog>
  )
}

// The head's second half: what the dialog shows in a sentence, and the numbers worth reading first.
export function DetailHero({ lead, stats = [] }) {
  return (
    <div className="detail-hero">
      {lead && <p className="detail-lead">{lead}</p>}
      {stats.length > 0 && (
        <dl className="stats">
          {stats.map(stat => (
            <div key={stat.label} className={stat.accent ? 'accent' : undefined}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
