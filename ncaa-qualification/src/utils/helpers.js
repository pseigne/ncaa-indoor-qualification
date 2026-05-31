// Convert performance time string e.g. "4:01.20" or "20.47@" to seconds float
export function parseTime(timeStr) {
  if (!timeStr) return 0;
  let clean = timeStr.replace(/[#@]/g, '').trim();
  if (clean.includes(':')) {
    let parts = clean.split(':');
    return (parseFloat(parts[0]) * 60) + parseFloat(parts[1]);
  }
  return parseFloat(clean);
}

// Convert seconds float back to min:sec.hundreds format
export function formatSecondsToMinsSecs(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds === 0) return '0.00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2);
  const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;
  return minutes > 0 ? `${minutes}:${formattedSeconds}` : `${seconds}`;
}

// Dynamic Qualifying Cutoff Logic
// Individuals: 16 (Indoor), 48 (Outdoor Individual)
// Relays: 12 (Indoor), 24 (Outdoor Relay)
// Multis & National Region (decathlon/heptathlon): 24 (Outdoor Multi)
export function getCutoffRank(eventName, season, region) {
  if (season === 'indoor') {
    const isRelay = eventName.toLowerCase().includes('relay') ||
      eventName.toLowerCase().includes('medley') ||
      eventName.toLowerCase().includes('4x');
    return isRelay ? 12 : 16;
  } else {
    const isRelay = eventName.toLowerCase().includes('4x') || eventName.toLowerCase().includes('relay');
    const isMulti = eventName.toLowerCase().includes('decathlon') ||
      eventName.toLowerCase().includes('heptathlon') ||
      region === 'National';
    if (isRelay) return 24;
    if (isMulti) return 24;
    return 48;
  }
}

// Check if an event is a field or multi event that should be filtered out
export function isFieldEvent(eventName) {
  const name = eventName.toLowerCase();
  return name.includes('jump') || 
         name.includes('vault') || 
         name.includes('put') || 
         name.includes('throw') ||
         name.includes('discus') ||
         name.includes('hammer') ||
         name.includes('javelin') ||
         name.includes('decathlon') ||
         name.includes('decathalon') ||
         name.includes('heptathlon') ||
         name.includes('heptathalon');
}

const INDOOR_ORDER = [
  '60 Meters',
  '60 Hurdles',
  '200 Meters',
  '400 Meters',
  '800 Meters',
  'Mile',
  '3000 Meters',
  '5000 Meters',
  '4 x 400 Relay',
  'Distance Medley Relay'
];

const OUTDOOR_ORDER = [
  '100 Meters',
  '110 Hurdles',
  '100 Hurdles',
  '200 Meters',
  '400 Meters',
  '400 Hurdles',
  '800 Meters',
  '1500 Meters',
  '3000 Steeplechase',
  '3000 Meters Steeplechase',
  '5000 Meters',
  '10000 Meters',
  '4 x 100 Relay',
  '4 x 400 Relay'
];

// Sort unique event names by distance with relays at the end
export function sortEvents(eventsList, season) {
  const orderList = season === 'indoor' ? INDOOR_ORDER : OUTDOOR_ORDER;
  return [...eventsList].sort((a, b) => {
    let indexA = orderList.findIndex(evt => a.toLowerCase().includes(evt.toLowerCase()) || evt.toLowerCase().includes(a.toLowerCase()));
    let indexB = orderList.findIndex(evt => b.toLowerCase().includes(evt.toLowerCase()) || evt.toLowerCase().includes(b.toLowerCase()));
    
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    
    return indexA - indexB;
  });
}


