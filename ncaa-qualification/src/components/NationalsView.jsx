import { Fragment } from 'react'
import { longDate, ordinal, surname, tidy } from '../utils/format'
import { useCompact } from '../utils/media'
import { markText, nationalsTitle, rowGroup, summaryParts, windText } from '../utils/nationals'
import { yearLabel } from '../utils/route'
import Logo from './Logo'
import '../nationals.css'

const CHEVRON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

const ROUND = {
  semifinal: ['SF', 'Semifinal'],
  prelim: ['Pre', 'Prelims'],
}

const STATUS = {
  DNS: 'Did not start',
  DNF: 'Did not finish',
  DQ: 'Disqualified',
  NM: 'No mark',
  NH: 'No height',
  FS: 'False start',
}

// Where the heat sheet breaks: the final, then those out in each earlier round, then no result.
const GROUP = {
  final: 'Final',
  semifinal: 'Out in the semifinals',
  prelim: 'Out in the prelims',
  none: 'Did not start, finish or mark',
  pending: 'No result',
}

// One event at the national meet: the 24 who went on from the First Rounds, as a heat sheet in final
// order, with the East against West count above it.
export default function NationalsView({ event, data, query, onOpenPicker }) {
  const compact = useCompact()
  const title = nationalsTitle(event, query.gender)
  const results = event.summary.results
  const firstRounds = event.qualifiers.some(q => q.firstRound)
  const wind = results && event.qualifiers.some(q => q.nationals?.wind)
  const groups = new Set(event.qualifiers.map(rowGroup))
  const breaks = results && groups.size > 1
  const columns = 4 + (event.isRelay ? 0 : 1) + (firstRounds ? 1 : 0) + (wind ? 1 : 0)
  const markHead = results
    ? (event.kind === 'time' ? 'Time' : event.kind === 'mark' ? 'Mark (m)' : 'Points')
    : 'Seed'

  return (
    <>
      <section className="herocard nat-hero">
        {compact ? (
          <h1>
            <button
              type="button"
              className="picker press"
              aria-haspopup="dialog"
              aria-label={`Change event, gender or season. Now: ${title}, ${yearLabel(data.year)}`}
              onClick={onOpenPicker}
            >
              {title}{CHEVRON}
            </button>
          </h1>
        ) : <h1>{title}</h1>}
        <p className="nat-meet">
          {data.meet.name || 'NCAA Division I Outdoor Championships'}
          {data.meet.start_date
            ? <>, from <time dateTime={data.meet.start_date}>{longDate(data.meet.start_date)}</time></>
            : `, ${data.year}`}
        </p>
        <p className="nat-lead">{leadCopy(event)}</p>
        <ul className="nat-sum" aria-label={event.multi ? 'The field' : 'East and West'}>
          {summaryParts(event.summary, event.multi).map(part => (
            <li key={part.label}><b>{part.label}</b> {part.words}</li>
          ))}
        </ul>
      </section>
      <section className="tablecard">
        <table
          id="list"
          tabIndex={-1}
          className={`nat${event.isRelay ? ' relay' : ''}`}
          aria-label={`${title}, ${results ? 'in final order' : 'in seed order'}`}
        >
          <thead>
            <tr>
              <th>{results ? 'Place' : '#'}</th>
              <th>{event.isRelay ? 'Team' : 'Athlete'}</th>
              {!event.isRelay && <th>Team</th>}
              <th>Region</th>
              {firstRounds && <th>First Round</th>}
              <th className="r">{markHead}</th>
              {wind && <th className="r">Wind</th>}
            </tr>
          </thead>
          <tbody>
            {event.qualifiers.map((q, at) => {
              const group = rowGroup(q)
              const heading = breaks && (at === 0 || rowGroup(event.qualifiers[at - 1]) !== group) ? GROUP[group] : null
              return (
                <Fragment key={`${q.athlete}|${q.team}|${at}`}>
                  {heading && (
                    <tr className="nat-grp"><th scope="rowgroup" colSpan={columns}>{heading}</th></tr>
                  )}
                  <Row q={q} at={at} event={event} results={results} firstRounds={firstRounds} wind={wind} group={group} />
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </section>
      {data.sources.length > 0 && (
        <p className="source">
          Source:{' '}
          {data.sources.map((source, at) => (
            <Fragment key={source.url}>
              {at ? ' · ' : null}
              <a href={source.url}>{source.label}</a>
            </Fragment>
          ))}.
        </p>
      )}
    </>
  )
}

function leadCopy(event) {
  if (event.multi) {
    return `The ${event.label.toLowerCase()} has no First Round: the top 24 declared on the national list go to nationals.`
  }
  const who = event.isRelay ? 'teams' : 'athletes'
  return `The top 12 ${who} in each event at each First Round, East and West, go on to nationals, 24 in all. A place left by a scratch at nationals is not filled.`
}

function Row({ q, at, event, results, firstRounds, wind, group }) {
  const n = q.nationals
  const name = event.isRelay ? tidy(q.team || q.athlete) : surname(q.athlete)
  const out = results && group !== 'final'
  return (
    <tr className={out ? 'out' : 'in'}>
      <td className="pl">{results ? <Place n={n} /> : at + 1}</td>
      <td className="ath">
        {event.isRelay ? <span className="tl"><Logo team={q.team || q.athlete} />{name}</span> : name}
      </td>
      {!event.isRelay && <td className="team"><span className="tl"><Logo team={q.team} />{tidy(q.team)}</span></td>}
      <td className="reg"><Region region={q.region} /></td>
      {firstRounds && <td className="fr"><FirstRound fr={q.firstRound} kind={event.kind} /></td>}
      <td className="t r">
        {results
          ? (n?.status ? <abbr className="nat-status" title={STATUS[n.status]}>{n.status}</abbr> : markText(n?.mark, event.kind))
          : markText(q.seed, event.kind)}
      </td>
      {wind && (
        <td className="wind r">{n?.wind && !n.status ? <><span className="ph">wind </span>{windText(n.wind)}</> : ''}</td>
      )}
    </tr>
  )
}

function Place({ n }) {
  if (n?.place && !n.status) return n.place
  const round = ROUND[n?.round]
  if (round) return <abbr title={round[1]}>{round[0]}</abbr>
  return <><span aria-hidden="true">—</span><span className="vh">No place</span></>
}

function Region({ region }) {
  if (region === 'National') return <span className="nat-reg national">National list</span>
  if (region === 'East' || region === 'West') {
    return (
      <span className={`nat-reg ${region.toLowerCase()}`}>
        <span aria-hidden="true">{region[0]}</span>
        <span className="vh">{region}</span>
      </span>
    )
  }
  return null
}

function FirstRound({ fr, kind }) {
  if (!fr) return <><span aria-hidden="true">—</span><span className="vh">No First Round</span></>
  return (
    <>
      <span className="ph">First Round </span>
      {fr.place ? <span className="nat-frp">{ordinal(fr.place)}</span> : null}
      {fr.place && fr.mark ? ' ' : null}
      {fr.mark ? markText(fr.mark, kind) : null}
      {fr.q && (
        <abbr className={`nat-q${fr.q === 'q' ? ' time' : ''}`} title={fr.q === 'Q' ? 'Advanced on place' : 'Advanced on time'}>
          {fr.q}
        </abbr>
      )}
    </>
  )
}
