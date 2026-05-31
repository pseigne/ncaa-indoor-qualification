import React, { useState, useEffect } from 'react';
import Controls from './Controls';
import CutoffChart from './CutoffChart';
import AltitudeModal from './AltitudeModal';
import { parseTime, getCutoffRank, isFieldEvent, sortEvents } from '../utils/helpers';

function Archive({ onBackHome }) {
  const [bubbleData, setBubbleData] = useState([]);
  const [activeData, setActiveData] = useState([]);
  const [cachedEventData, setCachedEventData] = useState({});
  const [loadingFullData, setLoadingFullData] = useState(false);
  const [selectedHistoricalRoster, setSelectedHistoricalRoster] = useState(null);

  const [selectedEvent, setSelectedEvent] = useState('all');
  const [gender, setGender] = useState('m');
  const [season, setSeason] = useState('indoor');
  const [region, setRegion] = useState('East');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [yearlyArchiveData, setYearlyArchiveData] = useState(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  const [showAltitudeModal, setShowAltitudeModal] = useState(false);

  // Load bubble cutoffs and active data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [bubbleRes, activeRes] = await Promise.all([
          fetch('/data/tfrrs_bubble_cutoffs.json'),
          fetch('/data/tfrrs_active_data.json')
        ]);
        if (!bubbleRes.ok || !activeRes.ok) throw new Error("Could not load databases");
        const bubData = await bubbleRes.json();
        const actData = await activeRes.json();
        setBubbleData(bubData);
        setActiveData(actData);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError("Error loading archive data. Please verify the scraper has run.");
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Resolve historical cutoff data when filters change
  useEffect(() => {
    if (selectedEvent === 'all' || !gender || !season || bubbleData.length === 0) {
      setYearlyArchiveData(null);
      return;
    }

    setLoadingGraph(true);

    const targetRegion = season === 'indoor' ? 'National' : region;
    const matchingBubble = bubbleData.filter(item =>
      item.season === season &&
      item.gender === gender &&
      item.event === selectedEvent &&
      (item.region === targetRegion || item.region === 'Unified')
    );

    // Yearly archive cutoffs (no date parentheses = finalized year records)
    const yearlyResults = matchingBubble
      .filter(item => !item.year.includes('('))
      .map(item => ({
        date: item.year.replace(/_/g, '-'),
        time: parseTime(item.cutoff_time),
        athlete: item.cutoff_athlete,
        team: item.cutoff_team,
        region: item.region
      }))
      .filter(r => r.time !== null && !isNaN(r.time))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Deduplicate
    const seenYears = new Set();
    const deduplicatedYearly = [];
    for (const r of yearlyResults) {
      if (!seenYears.has(r.date)) {
        seenYears.add(r.date);
        deduplicatedYearly.push(r);
      }
    }

    setYearlyArchiveData(deduplicatedYearly);
    setLoadingGraph(false);
  }, [selectedEvent, gender, season, region, bubbleData]);

  // Lazy-load historical roster on demand
  const handleViewHistoricalRoster = async (year, seasonType, regionSite, eventName, genderCat) => {
    try {
      const cleanEventFn = eventName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/(^_+|_+$)/g, '');
      const cacheKey = `${seasonType}_${genderCat}_${cleanEventFn}`;

      let data = cachedEventData[cacheKey];
      if (!data) {
        setLoadingFullData(true);
        const res = await fetch(`/data/historical_${cacheKey}.json`);
        if (!res.ok) throw new Error("Could not load historical roster");
        data = await res.json();
        setCachedEventData(prev => ({ ...prev, [cacheKey]: data }));
      }

      const roster = data.find(item => {
        const cleanItemYear = item.year.replace(/_/g, '-');
        const cleanInputYear = year.replace(/_/g, '-');
        return cleanItemYear === cleanInputYear && item.region === regionSite;
      });

      if (roster) {
        setSelectedHistoricalRoster(roster);
      } else {
        alert(`No detailed roster found for ${year} ${regionSite} ${eventName}`);
      }
      setLoadingFullData(false);
    } catch (err) {
      console.error(err);
      alert("Error loading historical roster data.");
      setLoadingFullData(false);
    }
  };

  // Build event options from active data
  const targetRegion = season === 'indoor' ? 'National' : region;
  const rawUniqueEvents = Array.from(
    new Set(
      activeData
        .filter(item =>
          item.season === season &&
          item.gender === gender &&
          item.region === targetRegion &&
          !isFieldEvent(item.event)
        )
        .map(item => item.event)
    )
  );
  const uniqueEvents = sortEvents(rawUniqueEvents, season);

  const eventOptions = [
    { value: 'all', label: 'All Events' },
    ...uniqueEvents.map(evt => ({ value: evt, label: evt }))
  ];

  const currentCutoffRank = selectedEvent !== 'all' ? getCutoffRank(selectedEvent, season, region) : 16;

  // Build summary data for "all events" overview using bubble cutoffs
  const allEventsSummary = selectedEvent === 'all'
    ? uniqueEvents.map(evt => {
      const cutoffRank = getCutoffRank(evt, season, region);
      const match = bubbleData.find(item =>
        item.season === season &&
        item.gender === gender &&
        item.event === evt &&
        (item.region === targetRegion || item.region === 'Unified') &&
        !item.year.includes('(')
      );
      return {
        event: evt,
        cutoffRank,
        time: match ? (match.cutoff_time || '').replace(/[@#]/g, '').trim() : '—',
        athlete: match ? match.cutoff_athlete : '',
        year: match ? match.year.replace(/_/g, '-') : ''
      };
    })
    : [];

  return (
    <div className="monitor-container" style={{ animation: 'fadeIn 0.5s ease-out' }}>
      {/* Compact Header */}
      <header className="monitor-compact-header">
        <div className="monitor-header-left">
          <button className="btn-back-home" onClick={onBackHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            Home
          </button>
          <span className="compact-badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' }}>Archive</span>
          <h1>Historical Archive</h1>
        </div>
      </header>

      <main className="app-main">
        {/* Season Toggle */}
        <section className="controls-card" style={{ marginBottom: '1rem' }}>
          <div className="control-group">
            <label className="control-label">Season</label>
            <div className="gender-tabs">
              <button
                type="button"
                className={`gender-tab-btn ${season === 'indoor' ? 'active' : ''}`}
                onClick={() => { setSeason('indoor'); setSelectedEvent('all'); }}
              >
                Indoor
              </button>
              <button
                type="button"
                className={`gender-tab-btn ${season === 'outdoor' ? 'active' : ''}`}
                onClick={() => { setSeason('outdoor'); setSelectedEvent('all'); }}
              >
                Outdoor
              </button>
            </div>
          </div>
        </section>

        <Controls
          gender={gender}
          setGender={setGender}
          season={season}
          region={region}
          setRegion={setRegion}
          selectedEvent={selectedEvent}
          setSelectedEvent={setSelectedEvent}
          eventOptions={eventOptions}
        />

        {loading && (
          <section className="results-section">
            <div className="data-loader">
              <div className="spinner"></div>
              <p>Loading archive data...</p>
            </div>
          </section>
        )}

        {error && (
          <section className="results-section">
            <div className="error-card">
              <span className="error-icon">⚠️</span>
              <p>{error}</p>
            </div>
          </section>
        )}

        {/* All Events Summary Grid */}
        {!loading && !error && selectedEvent === 'all' && (
          <section className="results-section">
            <div className="archive-section-header">
              <h2>Historical Bubble Cutoffs</h2>
              <p className="chart-desc">Select an event to view its historical cutoff trend and past rosters.</p>
            </div>
            <div className="events-summary-grid">
              {allEventsSummary.map((item, idx) => (
                <button
                  key={idx}
                  className="event-summary-card"
                  onClick={() => setSelectedEvent(item.event)}
                >
                  <span className="summary-event-name">{item.event}</span>
                  <span className="summary-bubble-time">{item.time || '—'}</span>
                  <span className="summary-label">
                    {item.year ? `${item.year} · #${item.cutoffRank}` : `Bubble (#${item.cutoffRank})`}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Single Event: Historical Chart + Roster Cards */}
        {!loading && !error && selectedEvent !== 'all' && (
          <>
            {yearlyArchiveData && yearlyArchiveData.length > 0 && (
              <CutoffChart
                historicalData={yearlyArchiveData}
                selectedEvent={selectedEvent}
                gender={gender}
                loadingGraph={loadingGraph}
                cutoffRank={currentCutoffRank}
                isArchive={true}
              />
            )}

            {yearlyArchiveData && yearlyArchiveData.length > 0 && (
              <section className="archive-roster-section">
                <div className="archive-section-header">
                  <h2>Historical Rosters</h2>
                  <p className="chart-desc">
                    Load the complete qualifying rosters (top 60 athletes) for past seasons of <strong>{selectedEvent}</strong>.
                  </p>
                </div>
                <div className="events-summary-grid">
                  {yearlyArchiveData.map(item => {
                    const displayRegion = item.region || (season === 'indoor' ? 'National' : (region || 'East'));
                    return (
                      <div key={item.date} className="archive-roster-card">
                        <div className="archive-roster-card-header">
                          <span className="archive-roster-year">{item.date}</span>
                          <span className="compact-badge" style={{ margin: 0, padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}>
                            {displayRegion}
                          </span>
                        </div>
                        <div className="archive-roster-bubble">
                          <span className="summary-bubble-time" style={{ fontSize: '1.25rem' }}>{item.time ? `${Math.floor(item.time / 60)}:${(item.time % 60).toFixed(2).padStart(5, '0')}` : '—'}</span>
                          {item.athlete && (
                            <span className="archive-roster-athlete">{item.athlete}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn-archive-compact"
                          style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
                          onClick={() => handleViewHistoricalRoster(item.date, season, displayRegion, selectedEvent, gender)}
                        >
                          View Full Roster
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {yearlyArchiveData && yearlyArchiveData.length === 0 && !loadingGraph && (
              <section className="results-section">
                <div className="no-results-card">
                  <p>No historical cutoff data found for <strong>{selectedEvent}</strong> ({gender === 'm' ? 'Men' : 'Women'}, {season}).</p>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="app-footer-credit">
        <p>
          Data sourced automatically from the TFRRS Qualifying Lists. &bull; Developed by{' '}
          <a
            href="https://pierceseigne.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: '600' }}
          >
            Pierce Seigne
          </a>
        </p>
      </footer>

      <AltitudeModal
        isOpen={showAltitudeModal}
        onClose={() => setShowAltitudeModal(false)}
      />

      {/* Full-screen loader for lazy roster fetch */}
      {loadingFullData && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 99999,
          color: '#fff',
          gap: '1rem',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div className="spinner" style={{ borderTopColor: '#8b5cf6', width: '50px', height: '50px' }}></div>
          <p style={{ fontWeight: '600', letterSpacing: '0.5px' }}>Loading Event Roster (~200KB)...</p>
        </div>
      )}

      {/* Historical roster detail modal */}
      {selectedHistoricalRoster && (
        <div className="archive-modal-backdrop" onClick={() => setSelectedHistoricalRoster(null)} style={{ zIndex: 99998 }}>
          <div className="archive-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '650px', maxHeight: '85vh', overflowY: 'auto' }}>
            <button className="archive-close-btn" onClick={() => setSelectedHistoricalRoster(null)}>&times;</button>
            <div className="archive-modal-header" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <h2>{selectedHistoricalRoster.year.replace(/_/g, '-')} Qualifying Roster</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {selectedHistoricalRoster.event} &bull; {selectedHistoricalRoster.region} &bull; {selectedHistoricalRoster.gender === 'm' ? 'Men' : 'Women'}
              </p>
            </div>

            <div className="historical-roster-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {selectedHistoricalRoster.rankings.map(athlete => {
                const bubbleRank = getCutoffRank(selectedHistoricalRoster.event, selectedHistoricalRoster.season, selectedHistoricalRoster.region);
                const isBubble = athlete.rank === bubbleRank;

                return (
                  <div
                    key={athlete.rank}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.7rem 1rem',
                      borderRadius: 'var(--border-radius-sm)',
                      background: isBubble ? 'rgba(139, 92, 246, 0.12)' : 'var(--bg-card)',
                      border: isBubble ? '1px solid #8b5cf6' : '1px solid var(--border-color)',
                      transition: 'transform 0.2s',
                      cursor: 'default'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{
                        fontWeight: '800',
                        color: isBubble ? '#8b5cf6' : 'var(--text-secondary)',
                        width: '28px',
                        fontSize: '0.95rem'
                      }}>
                        #{athlete.rank}
                      </span>
                      <div>
                        <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {athlete.athlete}
                          {isBubble && (
                            <span style={{ marginLeft: '0.5rem', background: '#8b5cf6', color: '#fff', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', textTransform: 'uppercase' }}>
                              Bubble Cutoff
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          {athlete.team}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontWeight: '850', color: isBubble ? '#8b5cf6' : 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.95rem' }}>
                      {athlete.time}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Archive;
