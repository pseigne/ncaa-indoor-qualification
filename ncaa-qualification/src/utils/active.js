// On touch screens there is no hover, so scrolling picks the row: the one whose middle sits nearest the
// reading line, half way down the part of the screen the sticky stack leaves free.

// When the strip is pinned, a band of page colour runs BAND px below it and then fades out over FADE px.
// Rows under either are hidden or half seen, so the free part of the screen starts below both.
export const BAND = 12
export const FADE = 12

export function freeTop(headBottom, stackBottom, pinned) {
  if (!(stackBottom > 0)) return headBottom
  return Math.max(headBottom, stackBottom + (pinned ? BAND + FADE : 0))
}

export function readingLine(top, bottom) {
  return top + (bottom - top) / 2
}

// rows: [{ rank, top, bottom }] in screen coordinates. Only rows whose middle is inside [from, to] count;
// on a tie the earlier row wins, so there is never more than one.
export function nearestRow(rows, target, { from = -Infinity, to = Infinity } = {}) {
  let best = null
  for (const row of rows) {
    if (!(row.bottom > row.top)) continue
    const middle = (row.top + row.bottom) / 2
    if (middle < from || middle > to) continue
    const distance = Math.abs(middle - target)
    if (!best || distance < best.distance) best = { rank: row.rank, distance }
  }
  return best ? best.rank : null
}
