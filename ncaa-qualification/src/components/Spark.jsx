import { finitePoints, stepPath } from '../utils/chart'
import { lowerBetter } from '../utils/format'

export default function Spark({ series, kind, width = 120, height = 22 }) {
  const points = finitePoints(series)
  if (!points.length) return null
  const values = points.map(point => point.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const path = stepPath(series, 1, width - 3, 2, height - 2, series[0].d, series.at(-1).d, min, max, !lowerBetter(kind))
  const last = points.at(-1)
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path.d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={path.tx(last.d)} cy={path.ty(last.v)} r="2" fill="currentColor" />
    </svg>
  )
}
