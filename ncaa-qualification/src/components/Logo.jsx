import { useState } from 'react'
import { logoFor, useLogos } from '../utils/logos'

// A school's logo before its name, or the school's initials when there is no logo to show. The initials
// are drawn from an attribute so they stay out of the row's text.
export default function Logo({ team, className = '' }) {
  const logos = useLogos()
  const [failed, setFailed] = useState(null)
  const found = logoFor(team, logos)
  if (!found) return null
  if (!found.src || failed === found.src) {
    return <span className={`logo logo-ini ${className}`} data-initials={found.initials} aria-hidden="true" />
  }
  return <img className={`logo ${className}`} src={found.src} alt="" aria-hidden="true" onError={() => setFailed(found.src)} />
}
