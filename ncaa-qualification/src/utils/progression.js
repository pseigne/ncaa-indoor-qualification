import championships from '../config/championships.json';
import { cutoffSeconds } from './qualification';

export function championshipFor(season, year) {
  return championships[season]?.[year.replace(/_/g, '-')] ?? null;
}

// Display only this season's saved observations, before the meet's first day.
// Keep later snapshots in the database and never invent a championship-day point.
export function progressionData(records, { season, gender, region, event, year }) {
  const normalizedYear = year.replace(/_/g, '-');
  const championship = championshipFor(season, normalizedYear);
  const targetRegion = season === 'indoor' ? 'National' : region;
  return records.flatMap(record => {
    const snapshot = record.year.replace(/_/g, '-').match(/^(.+) \((\d{4}-\d{2}-\d{2})\)$/);
    if (!snapshot || snapshot[1] !== normalizedYear || record.season !== season ||
        record.gender !== gender || record.event !== event ||
        (record.region !== targetRegion && record.region !== 'Unified') ||
        (championship && snapshot[2] >= championship.start_date)) return [];
    return [{ date: record.year, time: cutoffSeconds(record), snapshotDate: snapshot[2] }];
  }).sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}
