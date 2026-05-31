import React from 'react';
import Header from './Header';

function Layout({ children, onOpenArchive }) {
  return (
    <div className="app-container">
      {/* <button className="btn-archive" onClick={onOpenArchive}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="21 8 21 21 3 21 3 8"></polyline>
          <rect x="1" y="3" width="22" height="5" rx="1"></rect>
          <line x1="10" y1="12" x2="14" y2="12"></line>
        </svg>
        Archive
      </button> */}

      <Header />

      <main className="app-main">
        {children}
      </main>

      <footer className="app-footer-credit">
        <p>
          Data sourced automatically from the TFRRS Qualifying Lists. &bull; Developed by{' '}
          <a
            href="https://pierceseigne.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: '600' }}
          >
            Pierce Seigne
          </a>
        </p>
      </footer>
    </div>
  );
}

export default Layout;
