import { useState } from 'react'
import { LOGO_SHARE } from '../utils/chips'
import { logoFor, useLogos } from '../utils/logos'

// A runner's dot drawn as their school's logo on a white chip, with initials when there is no logo.
// The first one out gets a second, outer ring, like the outline on every other non-qualifier.
export default function LogoChip({ team, r, outline = false }) {
  const logos = useLogos()
  const [failed, setFailed] = useState(null)
  const found = logoFor(team, logos)
  const size = Math.round(2 * r * LOGO_SHARE * 10) / 10
  const src = found?.src && failed !== found.src ? found.src : null
  return (
    <>
      <circle className="cd-back" r={r} />
      {src ? (
        <image className="cd-logo" href={src} x={-size / 2} y={-size / 2} width={size} height={size} preserveAspectRatio="xMidYMid meet" onError={() => setFailed(src)} />
      ) : (
        <text className="cd-ini" textAnchor="middle" dy="0.36em" style={{ fontSize: `${Math.round(r * 0.8 * 10) / 10}px` }}>{found?.initials || ''}</text>
      )}
      <circle className="cd-ring" r={r} />
      {outline && <circle className="cd-outer" r={r + 3} />}
    </>
  )
}

