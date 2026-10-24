import { parseTime } from './helpers'

export const MINUS = '\u2212'
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CONVERSIONS = new Set(['flat', 'altitude', 'both'])

export const FOOTNOTE = '# converted for a flat or oversized track · @ converted for altitude. Conversions are TFRRS\'s.'

export const FLAG_COPY = {
  '#': 'Converted by TFRRS for a flat or oversized track.',
  '@': 'Converted by TFRRS for altitude.',
}

export const FLAG_LABEL = {
  '#': 'converted for a flat or oversized track',
  '@': 'converted for altitude',
}

// # is a flat or oversized track and @ is altitude. A mark can carry both.
export function markConversion(raw, flag, stored) {
  const text = `${raw ?? ''}${flag ?? ''}`
  const flat = text.includes('#')
  const altitude = text.includes('@')
  if (flat && altitude) return 'both'
  if (flat) return 'flat'
  if (altitude) return 'altitude'
  if (CONVERSIONS.has(stored)) return stored
  return null
}

export function markInfo(raw, source) {
  const text = raw == null ? '' : String(raw)
  const flag = source && typeof source === 'object' ? source.flag : source
  const stored = source && typeof source === 'object' ? source.conversion : undefined
  const conversion = markConversion(text, flag, stored)
  const flagged = `${text}${flag ?? ''}`
  const alt = flagged.includes('@') || conversion === 'altitude' || conversion === 'both'
  const note = flagged.includes('#') || conversion === 'flat' || conversion === 'both'
  const seconds = parseTime(text)
  const converted = source && typeof source === 'object' ? source.converted : null
  return {
    alt,
    note,
    v: Number.isFinite(seconds) ? seconds : null,
    conversion,
    raw: rawMark(converted),
  }
}

export function symbolsFor(conversion) {
  if (conversion === 'both') return ['#', '@']
  if (conversion === 'flat') return ['#']
  if (conversion === 'altitude') return ['@']
  return []
}

export function symbolString(conversion) {
  return symbolsFor(conversion).join('')
}

export function accessibleConversion(conversion) {
  return symbolsFor(conversion).map(symbol => FLAG_LABEL[symbol]).join(', ')
}

export function quietLines(conversion) {
  const lines = []
  if (conversion === 'flat' || conversion === 'both') lines.push('Mark converted for a flat track by TFRRS')
  if (conversion === 'altitude' || conversion === 'both') lines.push('Mark converted for altitude by TFRRS')
  return lines
}

// The unconverted mark is only the one TFRRS already recorded. Never reverse a conversion.
export function rawMark(converted) {
  if (!converted) return null
  const match = String(converted).match(/Converted from\s+(.+?)\s+for\b/i)
  const value = match?.[1]?.trim()
  return value || null
}

const NBSP = '\u00A0'

export function formatMark(v, kind) {
  if (!Number.isFinite(v)) return ''
  if (kind === 'mark') return `${v.toFixed(2)}${NBSP}m`
  if (kind === 'points') return `${Math.round(v).toLocaleString('en-US')}${NBSP}pts`
  if (v < 60) return v.toFixed(2)
  const minutes = Math.floor(v / 60)
  const seconds = v - minutes * 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds.toFixed(2)}`
}

export function formatBare(v, kind) {
  if (!Number.isFinite(v)) return ''
  if (kind === 'mark') return v.toFixed(2)
  if (kind === 'points') return Math.round(v).toLocaleString('en-US')
  return formatMark(v, kind)
}

export function signed(d, digits = 2) {
  const abs = Math.abs(d)
  const s = digits === 0 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(digits)
  return (d > 0 ? '+' : d < 0 ? MINUS : '±') + s
}

export function lowerBetter(kind) {
  return kind === 'time'
}

export function gapToLine(kind, lineV, v) {
  return lowerBetter(kind) ? v - lineV : lineV - v
}

export function unitWord(kind) {
  if (kind === 'mark') return '\u00A0m'
  if (kind === 'points') return '\u00A0pts'
  return 's'
}

export function formatGap(kind, gap) {
  const digits = kind === 'points' ? 0 : 2
  if (Math.abs(gap) < (kind === 'points' ? 0.5 : 1e-9)) return 'tie'
  return signed(gap, digits) + unitWord(kind)
}

export function ordinal(n) {
  const teen = n % 100
  const suffix = teen > 10 && teen < 14 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th')
  return `${n}${suffix}`
}

export function surname(name) {
  if (!name || name === 'N/A') return ''
  const clean = String(name).replace(/'/g, '\u2019')
  const [last, first] = clean.split(', ')
  return first ? `${first} ${last}` : clean
}

export function tidy(text) {
  return String(text || '').replace(/'/g, '\u2019')
}

export function familyName(name) {
  if (!name || name === 'N/A') return ''
  return String(name).replace(/'/g, '\u2019').split(', ')[0]
}

export function parseDay(iso) {
  return new Date(`${iso}T12:00:00`)
}

export function shortDate(iso) {
  const d = parseDay(iso)
  return `${MONTH[d.getMonth()]} ${d.getDate()}`
}

export function longDate(iso) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

export function eventTitle(event, gender, season, region) {
  const name = `${genderWord(gender, { possessive: true })} ${event.label.toLowerCase()}`
  return season === 'outdoor' ? `${name}, ${region}` : name
}

export function genderWord(gender, { possessive = false } = {}) {
  if (possessive) return gender === 'f' ? 'Women’s' : 'Men’s'
  return gender === 'f' ? 'women’s' : 'men’s'
}
