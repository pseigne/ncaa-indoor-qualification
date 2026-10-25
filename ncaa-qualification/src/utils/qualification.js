const unavailable = Object.freeze({ rank: null, is_relay: false, status: 'missing_rank', entry: null });

// Validate the saved contract; never reconstruct qualification policy here.
export function readQualification(record) {
  const value = record?.qualification;
  if (!value || !Number.isInteger(value.rank) || value.rank < 1 || typeof value.is_relay !== 'boolean') return unavailable;
  if (value.status === 'missing_rank' && value.entry === null) return value;
  const entry = value.entry;
  if (value.status !== 'available' || !entry || entry.rank !== value.rank ||
      typeof entry.athlete !== 'string' || !entry.athlete.trim() ||
      typeof entry.time !== 'string' || !entry.time.trim() ||
      (entry.team !== undefined && typeof entry.team !== 'string')) return unavailable;
  return value;
}

const FIELD = new Set(['available', 'unmatched', 'beyond_list']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const place = value => Number.isInteger(value) && value >= 1;
const places = value => Array.isArray(value) && value.every(place);

function listRow(entry) {
  return Boolean(entry) && place(entry.rank) &&
    typeof entry.athlete === 'string' && Boolean(entry.athlete.trim()) &&
    typeof entry.time === 'string' && Boolean(entry.time.trim()) &&
    (entry.team === undefined || typeof entry.team === 'string');
}

// The field as accepted, as Python matched it to the saved list; never decide here who got in.
// Anything malformed reads as no field at all. History lines carry it without `in` and `out`.
export function readField(record, { history = false } = {}) {
  const value = record?.field;
  if (!value || typeof value !== 'object' || !FIELD.has(value.status)) return null;
  if (!place(value.size) || typeof value.accepted !== 'string' || !DAY.test(value.accepted) ||
      typeof value.cancelled !== 'boolean' || !Number.isInteger(value.unmatched) || value.unmatched < 0) return null;
  if (value.rank !== null && !place(value.rank)) return null;
  if (history ? [value.in, value.out].some(ranks => ranks !== undefined && !places(ranks)) : !(places(value.in) && places(value.out))) return null;
  if (value.entry != null && !listRow(value.entry)) return null;
  if (value.status === 'available' && (value.unmatched !== 0 || !place(value.rank) || value.entry?.rank !== value.rank)) return null;
  if (value.status === 'unmatched' && value.unmatched === 0) return null;
  return value;
}
