import React from 'react';

function Controls({
  gender, setGender,
  season,
  region, setRegion,
  selectedEvent, setSelectedEvent,
  eventOptions
}) {
  return (
    <section className="controls-card">
      <div className="controls-selectors-group">
        {/* Gender Select */}
        <div className="control-group">
          <label className="control-label">Gender Category</label>
          <div className="gender-tabs">
            <button
              type="button"
              className={`gender-tab-btn ${gender === 'm' ? 'active' : ''}`}
              onClick={() => setGender('m')}
            >
              Men
            </button>
            <button
              type="button"
              className={`gender-tab-btn ${gender === 'f' ? 'active' : ''}`}
              onClick={() => setGender('f')}
            >
              Women
            </button>
          </div>
        </div>

        {/* Region Select (only active if Outdoor) */}
        {season === 'outdoor' && (
          <div className="control-group">
            <label className="control-label">Outdoor Region</label>
            <div className="gender-tabs">
              <button
                type="button"
                className={`gender-tab-btn ${region === 'East' ? 'active' : ''}`}
                onClick={() => setRegion('East')}
              >
                East
              </button>
              <button
                type="button"
                className={`gender-tab-btn ${region === 'West' ? 'active' : ''}`}
                onClick={() => setRegion('West')}
              >
                West
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Event Select Buttons */}
      <div className="control-group controls-events-group">
        <label className="control-label">Track & Field Event</label>
        <div className="event-buttons-grid">
          {eventOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`event-button ${selectedEvent === opt.value ? 'active' : ''}`}
              onClick={() => setSelectedEvent(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default Controls;
