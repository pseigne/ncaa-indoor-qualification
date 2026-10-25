import { useMemo } from 'react'
import { ordinal } from '../utils/format'
import { wentOn } from '../utils/nationals'
import { detailHref, plainClick } from '../utils/route'

const ARROW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

// A card for a regional event page, beside This season and Past years: how many of this First Round's
// qualifiers went to nationals and the best place among them. It opens the nationals dialog for the event.
//
//   event   the regional event's archive name, "100 Meters"
//   query   the page's query, for the dialog's link
//   data    the loaded nationals-outdoor-{year}-{g}.json, as fetched
//   go      the app's navigation, optional; without it the link is a plain link
//
// Nothing shows when the file has no such event. For the decathlon and heptathlon, which go to
// nationals from the national list rather than a First Round, it counts the whole field.
export default function NationalsCard({ event, query, data, go }) {
  const went = useMemo(() => wentOn(data, event, query.region), [data, event, query.region])
  if (!went) return null
  return (
    <a
      className="detail-card press"
      data-detail="nationals"
      href={detailHref(query, 'nationals', went.slug)}
      aria-haspopup="dialog"
      onClick={click => { if (go && plainClick(click)) go(click.currentTarget.href, click) }}
    >
      <span className="detail-t">Nationals</span>
      <span className="detail-x">{cardSentence(went)}</span>
      <span className="detail-go">The national meet{ARROW}</span>
    </a>
  )
}

function cardSentence({ multi, count, best, results }) {
  if (multi) return `${count} went to nationals from the national list`
  const went = count === 0 ? 'None went to nationals' : `${count} went to nationals`
  if (!count || !results) return went
  return best ? `${went} · best finish ${ordinal(best)}` : `${went} · none in the final`
}
