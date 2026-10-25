// Only the leader and the first one out get a logo chip: the two dots that already carry gutter labels.
// Like the labels, each takes the first dot listed at that place, so a shared place gets one chip, and a
// line drawn at the last entry leaves only the leader's. A first one out the field took in stays a plain
// dot: its chip, drawn clear of the qualifying line, would land on the far side of the field line.
export function chipDots(placed, lineRank, fieldRank = null) {
  const leader = placed.find(dot => dot.rank === 1)
  const taken = Number.isFinite(fieldRank) && fieldRank > lineRank
  const firstOut = Number.isFinite(lineRank) && !taken ? placed.find(dot => dot.rank === lineRank + 1) : null
  return [leader, firstOut].filter((dot, index, list) => dot && list.indexOf(dot) === index)
}

// Plain dots first, chips last, so a chip sits above its neighbours. Placement is unchanged.
export function chipsLast(placed, chips) {
  return [...placed.filter(dot => !chips.includes(dot)), ...chips]
}

export const CHIP = 12
export const CHIP_PHONE = 10
// The logo fills this share of the chip's diameter.
export const LOGO_SHARE = 0.7

// The two chips have a fixed size, 24px across (20px on a phone strip), wherever they sit: they never
// shrink near the qualifying line. Only plain dots change size.
export function chipRadius(phone = false) {
  return phone ? CHIP_PHONE : CHIP
}

// A chip is wider than the dot it stands for. Near the qualifying line it would cover the 3px line and the
// line holder's dot, and the line would no longer sit between the line holder and the first one out. So a
// chip is drawn just clear of both, on its own side of the line: behind it for the first one out, ahead of
// it for the leader. The layout keeps the dot's position; only the drawing moves, and only that far.
// `side` is -1 for the side with lower coordinates and +1 for the other; 0 leaves the chip where it is.
export function chipCentre(at, lineAt, side, { r, outline = false, dotRadius }) {
  const clear = Math.max(1.5, dotRadius) + 1 + r + (outline ? 3 : 0)
  if (side < 0) return Math.min(at, lineAt - clear)
  if (side > 0) return Math.max(at, lineAt + clear)
  return at
}

// The scroll-picked runner's dot becomes a chip too, unless it already is one (the leader or the first
// one out), so there is never a second chip for the same runner.
export function liftedDot(placed, rank, chips) {
  if (rank == null) return null
  const dot = placed.find(item => item.rank === rank)
  return dot && !chips.includes(dot) ? dot : null
}

// Where a chip is drawn away from its own spot (to stay clear of the line), plain dots partly under it peek
// out beside it as a crescent and read as a second ring for the same runner. Any plain dot that overlaps a
// moved chip is left undrawn while the chip covers it; the runners are still in the table. `covers` lists
// each chip as drawn: { dot, x, y, reach }, with `reach` its outer radius; `radius` is a plain dot's.
export function coveredDots(placed, covers, radius = 0) {
  const moved = covers.filter(cover => cover.x !== cover.dot.x || cover.y !== cover.dot.y)
  const chips = covers.map(cover => cover.dot)
  return new Set(placed.filter(dot => !chips.includes(dot)
    && moved.some(cover => Math.hypot(dot.x - cover.x, dot.y - cover.y) < cover.reach + radius)))
}
