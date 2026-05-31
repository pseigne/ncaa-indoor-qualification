import React, { useState } from 'react';
import Welcome from './components/Welcome';
import Monitor from './components/Monitor';
import Archive from './components/Archive';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('welcome'); // 'welcome', 'monitor', or 'archive'
  const [initialSeason, setInitialSeason] = useState('indoor');

  const handleSelectSeason = (seasonSelected) => {
    setInitialSeason(seasonSelected);
    setCurrentView('monitor');
  };

  const handleOpenArchive = () => {
    setCurrentView('archive');
  };

  const handleBackHome = () => {
    setCurrentView('welcome');
  };

  return (
    <div className="app-container">
      {currentView === 'welcome' && (
        <Welcome
          onSelectSeason={handleSelectSeason}
          onOpenArchive={handleOpenArchive}
        />
      )}
      {currentView === 'monitor' && (
        <Monitor
          initialSeason={initialSeason}
          onBackHome={handleBackHome}
          onOpenArchive={handleOpenArchive}
        />
      )}
      {currentView === 'archive' && (
        <Archive
          onBackHome={handleBackHome}
        />
      )}
    </div>
  );
}

export default App;

