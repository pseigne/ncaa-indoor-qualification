import React, { useState } from 'react';

function EventCard({ eventGroup, getCutoffRank, season, region, onAltitudeClick }) {
  const [expanded, setExpanded] = useState(false);
  const cutoffRank = getCutoffRank(eventGroup.event, season, region);
  const hasMore = eventGroup.rankings.length > cutoffRank;

  const displayedRankings = expanded ? eventGroup.rankings : eventGroup.rankings.slice(0, cutoffRank);

  const isRelay = eventGroup.event.toLowerCase().includes('relay') || 
                  eventGroup.event.toLowerCase().includes('medley') || 
                  eventGroup.event.toLowerCase().includes('4x');

  return (
    <div className="event-card">
      <div className="event-card-header">
        <h3>{eventGroup.event.replace(/\s+/g, ' ').trim()}</h3>
        <span className="qualifiers-count">Top {cutoffRank} Qualify</span>
      </div>
      <div className="table-responsive">
        <table className="results-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>{isRelay ? 'Team' : 'Athlete'}</th>
              {!isRelay && <th>Team</th>}
              <th className="text-right">Performance</th>
            </tr>
          </thead>
          <tbody>
            {displayedRankings.map((entry) => {
              const isCutoff = entry.rank === cutoffRank;
              return (
                <tr 
                  key={entry.rank} 
                  className={`athlete-row ${isCutoff ? 'bubble-cutoff' : ''}`}
                >
                  <td className="rank-cell">
                    <span className={`rank-badge ${entry.rank <= cutoffRank ? 'in-cutoff' : 'out-cutoff'}`}>
                      {entry.rank}
                    </span>
                  </td>
                  <td className="athlete-info">
                    <span className="athlete-name">{isRelay ? entry.team : entry.athlete}</span>
                  </td>
                  {!isRelay && (
                    <td className="team-info">
                      <span className="team-name">{entry.team || 'N/A'}</span>
                    </td>
                  )}
                  <td className="time-cell text-right">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end' }}>
                      {entry.time && entry.time.includes('@') && (
                        <span 
                          className="altitude-badge" 
                          onClick={onAltitudeClick}
                          title="Altitude Conversion Applied. Click for details."
                        >
                          Altitude
                        </span>
                      )}
                      <span className="performance-time">
                        {entry.time ? entry.time.replace(/[@#]/g, '').trim() : ''}
                      </span>
                    </div>
                    {isCutoff && (
                      <span className="bubble-badge">Bubble Target</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="show-more-container">
          <button 
            className="btn-show-more" 
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                Show Bubble Only
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="chevron-icon">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </>
            ) : (
              <>
                Show More ({eventGroup.rankings.length - cutoffRank} below bubble)
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="chevron-icon">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default EventCard;
