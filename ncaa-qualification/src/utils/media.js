import { useEffect, useState } from 'react'

function matches(query) {
  try { return window.matchMedia(query).matches } catch { return false }
}

export function useMedia(query) {
  const [on, setOn] = useState(() => matches(query))
  useEffect(() => {
    let mq
    try { mq = window.matchMedia(query) } catch { return undefined }
    const update = () => setOn(mq.matches)
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [query])
  return on
}

export function usePhone() {
  return useMedia('(max-width: 720px)')
}

// From 1100px the event page splits: table on the left, the race standing up on the right.
export function useSplit() {
  return useMedia('(min-width: 1100px)')
}

// Phones, and the narrowest split widths, trade the event list for the picker.
export function useCompact() {
  const phone = usePhone()
  const tight = useMedia('(min-width: 1100px) and (max-width: 1279px)')
  return phone || tight
}

export function useReduceMotion() {
  return useMedia('(prefers-reduced-motion: reduce)')
}

export function useWidth() {
  const [width, setWidth] = useState(() => window.innerWidth || 1440)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}
