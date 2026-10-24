import { useEffect, useId, useRef } from 'react'
import { focusHeading, trapTab } from '../utils/focus'

const CROSS = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

// A dialog over the event page, built like it: a dark head like the hero card, then white cards on the
// page's ground. The URL holds it open, so it can be linked to and Back closes it. Closed by Escape,
// Close, a click outside or Back: focus goes back to the card that opens it.
export default function DetailSheet({ name, eyebrow, title, onClose, children }) {
  const ref = useRef(null)
  const id = useId()
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
      onClose()
      return
    }
    trapTab(key, ref.current)
  }
  return (
    <dialog
      ref={ref}
      className="sheet detail"
      aria-labelledby={`${id}-e ${id}-t`}
      onCancel={cancel => { cancel.preventDefault(); onClose() }}
      onKeyDown={onKeyDown}
      onClick={click => { if (click.target === ref.current) onClose() }}
    >
      <div className="detail-head">
        <div>
          <p className="detail-eyebrow" id={`${id}-e`}>{eyebrow}</p>
          <h2 id={`${id}-t`}>{title}</h2>
        </div>
        <button type="button" className="press close" onClick={onClose}>{CROSS}Close</button>
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
