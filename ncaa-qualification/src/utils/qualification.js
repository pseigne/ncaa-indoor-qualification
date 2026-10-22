import { parseTime } from './helpers';

const unavailable = Object.freeze({ rank: null, is_relay: false, status: 'missing_rank', entry: null });

// Validate the generated contract; never reconstruct qualification policy here.
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

export function cutoffPerformance(record) {
  const { entry } = readQualification(record);
  return entry ? entry.time.replace(/[@#]/g, '').trim() : 'Cutoff unavailable';
}

export function cutoffSeconds(record) {
  const { entry } = readQualification(record);
  if (!entry) return null;
  const seconds = parseTime(entry.time);
  return Number.isFinite(seconds) ? seconds : null;
}
