import { Fragment } from 'react'
import { longDate, ordinal, surname, tidy } from '../utils/format'
import { markText, rowGroup, summaryParts, windText } from '../utils/nationals'
import { DetailHero } from './DetailSheet'
import Logo from './Logo'
import '../nationals.css'

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

// The national meet dialog for one event, over a regional event page: the 24 who went on from the two
// First Rounds, as a heat sheet in final order, with the East against West count above it.
export default function NationalsDetail({ event, data }) {
  const results = event.summary.results
  const firstRounds = event.qualifiers.some(q => q.firstRound)
  const wind = results && event.qualifiers.some(q => q.nationals?.wind)
  const groups = new Set(event.qualifiers.map(rowGroup))
  const breaks = results && groups.size > 1
  const columns = 4 + (event.isRelay ? 0 : 1) + (firstRounds ? 1 : 0) + (wind ? 1 : 0)
  const markHead = results
    ? (event.kind === 'time' ? 'Time' : event.kind === 'mark' ? 'Mark (m)' : 'Points')
    : 'Seed'
  const meet = data.meet.name || 'NCAA Division I Outdoor Championships'

  return (
    <>
      <DetailHero
        lead={(
          <>
            <span className="nat-meet">
              {meet}
              {data.meet.start_date
                ? <>, from <time dateTime={data.meet.start_date}>{longDate(data.meet.start_date)}</time></>
                : `, ${data.year}`}.
            </span>{' '}
            {leadCopy(event)}
          </>
        )}
        stats={summaryParts(event.summary, event.multi).map(part => ({ label: part.label, value: part.words }))}
      />
      <section className="detail-box nat-box">
        <table
          className={`nat${event.isRelay ? ' relay' : ''}`}
          aria-label={`${event.label} at nationals, ${results ? 'in final order' : 'in seed order'}`}
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
      </section>
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
