import React from 'react';
import Header from './Header';

function Welcome({ onSelectSeason, onOpenArchive }) {
  return (
    <div className="welcome-container" style={{ animation: 'fadeIn 0.6s ease-out' }}>
      <Header />

      <div className="welcome-options-grid">
        <button
          className="welcome-card-btn outdoor"
          onClick={() => onSelectSeason('outdoor')}
        >
          <div className="welcome-card-icon">☀️</div>
          <h2>Current Outdoor</h2>
          <p>Analyze active Division I East & West regional outdoor lists and bubble ranks.</p>
        </button>

        <button
          className="welcome-card-btn indoor"
          onClick={() => onSelectSeason('indoor')}
        >
          <div className="welcome-card-icon">🏠</div>
          <h2>Current Indoor</h2>
          <p>Monitor active Division I national indoor qualifying rosters and standard targets.</p>
        </button>

        {/* <button
          className="welcome-card-btn archive"
          onClick={onOpenArchive}
        >
          <div className="welcome-card-icon">📂</div>
          <h2>Historical Archive</h2>
          <p>Review comprehensive historical cutoff timelines, snapshots, and metrics.</p>
        </button> */}
      </div>

      <div className="welcome-about-card">
        <h3>About the Tracker</h3>
        <p>
          This dashboard compiles current-season standings and historical qualification thresholds for NCAA Division I Track & Field championships. Roster lists are refreshed nightly from TFRRS with altitude and track size conversions applied. Track events are arranged in ascending order of distance, with relays positioned at the end.
        </p>

        <div className="about-standards-grid">
          <div className="standards-column">
            <h4>Indoor Qualifying</h4>
            <ul>
              <li><strong>Top 16</strong> Individual entries nationally advance to final rounds</li>
              <li><strong>Top 12</strong> Relays (DMR and 4x400) qualify for finals</li>
            </ul>
          </div>
          <div className="standards-column">
            <h4>Outdoor Qualifying</h4>
            <ul>
              <li><strong>Top 48</strong> Regional individual entries qualify for First Rounds</li>
              <li><strong>Top 24</strong> Regional relays (4x100 and 4x400) qualify for First Rounds</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Welcome;
