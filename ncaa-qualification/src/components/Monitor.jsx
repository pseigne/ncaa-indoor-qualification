import React, { useState, useEffect } from 'react';
import Controls from './Controls';
import EventsList from './EventsList';
import AltitudeModal from './AltitudeModal';
import CutoffChart from './CutoffChart';
import { parseTime, getCutoffRank, isFieldEvent, sortEvents } from '../utils/helpers';

function Monitor({ initialSeason, onBackHome, onOpenArchive }) {
  const [activeData, setActiveData] = useState([]);
  const [bubbleData, setBubbleData] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState('all');
  const [gender, setGender] = useState('m');
  const [season, setSeason] = useState(initialSeason);
  const [region, setRegion] = useState('East');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Active season daily progression data
  const [seasonProgressionData, setSeasonProgressionData] = useState(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  const [showAltitudeModal, setShowAltitudeModal] = useState(false);

  // Sync season if initialSeason prop changes
  useEffect(() => {
    setSeason(initialSeason);
  }, [initialSeason]);

  // 1. Initial Load
  useEffect(() => {
    async function loadInitialData() {
      try {
        setLoading(true);
        const [activeRes, bubbleRes] = await Promise.all([
          fetch('/data/tfrrs_active_data.json'),
          fetch('/data/tfrrs_bubble_cutoffs.json')
        ]);
        if (!activeRes.ok || !bubbleRes.ok) throw new Error("Could not load initial databases");
        const actData = await activeRes.json();
        const bubData = await bubbleRes.json();
        setActiveData(actData);
        setBubbleData(bubData);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError("Error loading qualifying data. Please verify the scraper has successfully run.");
        setLoading(false);
      }
    }
    loadInitialData();
  }, []);

  // 2. Resolve active season progression when filters change
  useEffect(() => {
    if (selectedEvent === 'all' || !gender || !season || bubbleData.length === 0) {
      setSeasonProgressionData(null);
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

    // Active season progression (those with dates in parentheses)
    const progressionResults = matchingBubble
      .filter(item => item.year.includes('('))
      .map(item => ({
        date: item.year,
        time: parseTime(item.cutoff_time)
      }))
      .filter(r => r.time !== null && !isNaN(r.time))
      .sort((a, b) => {
        const getSortKey = (str) => {
          const m = str.match(/\((.*?)\)/);
          return m ? m[1] : str;
        };
        return getSortKey(a.date).localeCompare(getSortKey(b.date));
      });

    setSeasonProgressionData(progressionResults);
    setLoadingGraph(false);
  }, [selectedEvent, gender, season, region, bubbleData]);

  // Determine active year dynamically
  const activeSelectionYears = activeData
    .filter(item => item.season === season && item.gender === gender)
    .map(item => {
      const match = item.year.match(/^(.*?)\s*\(/);
      const rawYear = match ? match[1] : item.year;
      return rawYear.replace(/_/g, '-');
    });
  const uniqueYears = Array.from(new Set(activeSelectionYears)).sort();
  const latestYear = uniqueYears.length > 0 ? uniqueYears[uniqueYears.length - 1] : '2026';

  // Filter events to display
  const targetRegion = season === 'indoor' ? 'National' : region;
  const filteredEvents = activeData.filter(item => {
    const cleanItemYear = item.year.replace(/_/g, '-');
    return (
      cleanItemYear === latestYear &&
      item.season === season &&
      item.gender === gender &&
      item.region === targetRegion &&
      !isFieldEvent(item.event) &&
      (selectedEvent === 'all' || item.event === selectedEvent)
    );
  });

  // Build event options
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

  return (
    <div className="monitor-container" style={{ animation: 'fadeIn 0.5s ease-out' }}>
      {/* Compact Header Bar */}
      <header className="monitor-compact-header">
        <div className="monitor-header-left">
          <button className="btn-back-home" onClick={onBackHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            Home
          </button>
          <span className="compact-badge">DI Tracker</span>
          <h1>NCAA {season === 'indoor' ? 'Indoor' : 'Outdoor'} Monitor</h1>
        </div>

        {/* <button className="btn-archive-compact" onClick={onOpenArchive}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8"></polyline>
            <rect x="1" y="3" width="22" height="5" rx="1"></rect>
            <line x1="10" y1="12" x2="14" y2="12"></line>
          </svg>
          Archive
        </button> */}
      </header>

      <main className="app-main">
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

        {selectedEvent !== 'all' && seasonProgressionData && seasonProgressionData.length > 0 && (
          <CutoffChart
            historicalData={seasonProgressionData}
            selectedEvent={selectedEvent}
            gender={gender}
            loadingGraph={loadingGraph}
            cutoffRank={currentCutoffRank}
            isArchive={false}
          />
        )}

        <EventsList
          loading={loading}
          error={error}
          filteredEvents={filteredEvents}
          getCutoffRank={getCutoffRank}
          season={season}
          region={region}
          onAltitudeClick={() => setShowAltitudeModal(true)}
          selectedEvent={selectedEvent}
          onSelectEvent={setSelectedEvent}
        />
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
    </div>
  );
}

export default Monitor;
