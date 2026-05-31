import React from 'react';

function AltitudeModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="archive-modal-backdrop" onClick={onClose}>
      <div className="archive-modal-content" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
        <button className="archive-close-btn" onClick={onClose}>&times;</button>
        
        <div className="archive-modal-header" style={{ marginBottom: '1.5rem' }}>
          <h2>Altitude Conversions</h2>
          <p className="chart-desc">NCAA Track & Field Adjustments</p>
        </div>

        <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p>
            Performances recorded at tracks located at high altitudes (typically above 3,000 feet) receive an official NCAA mathematical conversion to ensure fair qualifying comparisons across different venues.
          </p>
          <p>
            Thinner air reduces aerodynamic drag (aiding short sprints) but significantly decreases oxygen availability (hindering distance events). Specialized conversion formulas normalize all marks to standard sea-level equivalents.
          </p>
          <p>
            You can read the official conversion guidelines and use the interactive calculators directly on the TFRRS website:
          </p>
          
          <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'center' }}>
            <a 
              href="https://www.tfrrs.org/conversion" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.5rem',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                fontWeight: '600',
                borderRadius: '50px',
                textDecoration: 'none',
                boxShadow: 'var(--shadow-sm)',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--primary-hover)'}
              onMouseOut={e => e.currentTarget.style.backgroundColor = 'var(--primary)'}
            >
              Official TFRRS Calculator
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AltitudeModal;
