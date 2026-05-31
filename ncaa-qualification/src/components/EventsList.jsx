import React from 'react';
import EventCard from './EventCard';

function EventsList({ loading, error, filteredEvents, getCutoffRank, season, region, onAltitudeClick, selectedEvent, onSelectEvent }) {
  if (loading) {
    return (
      <section className="results-section">
        <div className="data-loader">
          <div className="spinner"></div>
          <p>Fetching active TFRRS rosters...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="results-section">
        <div className="error-card">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
        </div>
      </section>
    );
  }

  if (filteredEvents.length === 0) {
    return (
      <section className="results-section">
        <div className="no-results-card">
          <p>No event groups match the current filters.</p>
        </div>
      </section>
    );
  }

  // When "All Events" is selected, show a compact summary grid
  if (selectedEvent === 'all') {
    return (
      <section className="results-section">
        <div className="events-summary-grid">
          {filteredEvents.map((eventGroup, idx) => {
            const cutoffRank = getCutoffRank(eventGroup.event, season, region);
            const bubbleEntry = eventGroup.rankings.find(r => r.rank === cutoffRank);
            const bubbleTime = bubbleEntry
              ? (bubbleEntry.time || '').replace(/[@#]/g, '').trim()
              : '—';

            return (
              <button
                key={idx}
                className="event-summary-card"
                onClick={() => onSelectEvent && onSelectEvent(eventGroup.event)}
              >
                <span className="summary-event-name">{eventGroup.event.replace(/\s+/g, ' ').trim()}</span>
                <span className="summary-bubble-time">{bubbleTime}</span>
                <span className="summary-label">Bubble (#{cutoffRank})</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  // When a specific event is selected, show the full roster card(s)
  return (
    <section className="results-section">
      <div className="events-grid">
        {filteredEvents.map((eventGroup, idx) => (
          <EventCard
            key={idx}
            eventGroup={eventGroup}
            getCutoffRank={getCutoffRank}
            season={season}
            region={region}
            onAltitudeClick={onAltitudeClick}
          />
        ))}
      </div>
    </section>
  );
}

export default EventsList;
