// Focus the page's picker button, or its heading when it has none.
export function focusHeading() {
  const heading = document.querySelector('main h1')
  const target = heading?.querySelector('button.picker') || heading
  if (!target) return
  if (target === heading) heading.tabIndex = -1
  target.focus()
}

// Tab and Shift+Tab wrap inside an open dialog.
export function trapTab(key, root) {
  if (key.key !== 'Tab' || !root) return
  const stops = [...root.querySelectorAll('a[href], button, [tabindex="0"]')]
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
