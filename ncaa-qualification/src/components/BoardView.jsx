import { finitePoints } from '../utils/chart'
import { comparisonSeries, comparisonStart, pickComparison } from '../utils/comparison'
import { formatBare, formatMark, genderWord, shortDate, signed, surname, tidy, unitWord } from '../utils/format'
import { grouped } from '../utils/model'
import { href, plainClick, yearLabel } from '../utils/route'
import Spark from './Spark'
import { Filters, Source } from './Frame'
import { Mark } from './Mark'

const CHEVRON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export default function BoardView({ events, query, go, context, phone = false, onOpenPicker }) {
  const who = genderWord(query.gender, { possessive: true })
  const place = query.season === 'outdoor' ? `${who} outdoor, ${query.region}` : `${who} indoor`
  const when = context.listDate ? `${shortDate(context.listDate)}, ${context.listDate.slice(0, 4)}` : null
  return (
    <>
      {!phone && <Filters query={query} go={go} />}
      {phone ? (
        <h1>
          <button
            type="button"
            className="picker press"
            aria-haspopup="dialog"
            aria-label="Change event, gender or season. Now: Every qualifying line"
            onClick={onOpenPicker}
          >
            Every qualifying line{CHEVRON}
          </button>
        </h1>
      ) : <h1>Every qualifying line</h1>}
      <p className="lead board-lead">
        {place}{context.past ? `, final list of ${yearLabel(context.year)}` : when ? `, ${context.final ? 'final' : 'latest'} list of ${when}` : ''}.
        {query.season === 'indoor'
          ? ' Each line is the mark you needed to be inside the top 16 (top 12 for relays).'
          : ' Each line is the last qualifying place on that list.'}
      </p>
      <table className="board" id="list" tabIndex={-1} aria-label="Every qualifying line">
        <thead>
          <tr>
            <th>Event</th>
            <th className="r">Line</th>
            <th>Held by</th>
            <th><span className="vh">Team</span></th>
            <th>Since Feb 1</th>
            <th className="r">Season, faster ↑</th>
          </tr>
        </thead>
        <tbody>
          {grouped(events).map(group => (
            <Group key={group.name} group={group} query={query} go={go} year={context.year} />
          ))}
        </tbody>
      </table>
      <Source
        season={query.season}
        year={context.year}
        region={query.region}
        listDate={context.listDate}
        final={context.final}
        query={query}
        go={go}
        board
        list={context.list}
        extra="Field and combined events with no saved daily marks show the final mark only."
        footnote={events.some(item => item.line?.conversion)}
      />
    </>
  )
}

function Group({ group, query, go, year }) {
  return (
    <>
      <tr className="grp"><td colSpan={6}>{group.name}</td></tr>
      {group.events.map(event => {
        const all = finitePoints(event.series)
        // The same saved line the event page compares with: the first full list from Feb 1.
        const from = pickComparison(all, { rank: event.line?.rank ?? event.rank, year })
        const points = comparisonSeries(all, from)
        const since = all.length ? change(event, points, year) : ''
        return (
          <tr key={event.slug}>
            <td className="ev">
              <a href={href({ ...query, view: 'event', event: event.slug })} onClick={click => { if (plainClick(click)) go(click.currentTarget.href, click) }}>
                {event.label}
              </a>
              {event.rank && event.rank !== 16 ? <small>top {event.rank}</small> : null}
            </td>
            <td className="t r">
              {event.line
                ? <Mark text={formatMark(event.line.v, event.kind)} conversion={event.line.conversion} raw={event.line.raw} hang />
                : 'Cutoff unavailable'}
            </td>
            <td className="who">{event.line ? (event.isRelay ? tidy(event.line.team || event.line.athlete) : surname(event.line.athlete)) : ''}</td>
            <td className="team">{event.line && !event.isRelay ? tidy(event.line.team) : ''}</td>
            <td className={points.length ? 'since' : 'none'} data-since={from?.d}>{since}</td>
            <td className="r sp">{points.length > 1 ? <Spark series={comparisonSeries(event.series, from)} kind={event.kind} width={96} height={20} /> : ''}</td>
          </tr>
        )
      })}
    </>
  )
}

// Change since the chosen saved line, naming its date only when the guard moved it past Feb 1.
function change(event, points, year) {
  if (!points.length) return 'No full list since Feb 1'
  if (points.length < 2) return 'Not tracked yet'
  const start = points[0]
  const later = start.d !== comparisonStart(year) ? ` since ${shortDate(start.d)}` : ''
  const delta = points.at(-1).v - start.v
  const digits = event.kind === 'points' ? 0 : 2
  if (Math.abs(delta) < (digits === 0 ? 0.5 : 0.005)) return `held since ${shortDate(start.d)}`
  return `${signed(delta, digits)}${unitWord(event.kind)} from ${formatBare(start.v, event.kind)}${later}`
}
