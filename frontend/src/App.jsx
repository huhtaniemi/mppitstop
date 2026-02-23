import React, { useState, useEffect } from 'react';
import { SelectionsSummary } from './components/SelectionsSummary';
import { PartsFeed } from './components/PartsFeed';
import { ChangesHistory } from './components/ChangesHistory';
import './App.css';

function App() {
  const [view, setView] = useState('main'); // main, collections, history
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeBrandsInput, setScrapeBrandsInput] = useState('Aprilia 125,Cagiva 125');
  const [removeModelInput, setRemoveModelInput] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [feedVersion, setFeedVersion] = useState(0);
  const [feedStats, setFeedStats] = useState({
    filtered: 0,
    loaded: 0,
    total: 0,
    motorcycles: 0,
    parts: 0,
    brands: 0
  });

  useEffect(() => {
    fetch('/api/motorcycles/scrape-status')
      .then((r) => r.json())
      .then((d) => setIsScraping(Boolean(d?.running)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isScraping) return;
    const check = async () => {
      try {
        const response = await fetch('/api/motorcycles/scrape-status');
        const data = await response.json();
        setIsScraping(Boolean(data?.running));
      } catch (err) {
        console.error('Error checking scrape status:', err);
      }
    };
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, [isScraping]);

  const handleViewCollections = () => {
    setView('collections');
  };

  const handleBackFromCollections = () => {
    setView('main');
  };

  const handleScrape = async () => {
    try {
      const brands = scrapeBrandsInput.split(',').map(s => s.trim()).filter(Boolean);
      const response = await fetch('/api/motorcycles/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brands }) });
      const data = await response.json();
      setIsScraping(data?.status === 'scraping' || data?.running === true);
    } catch (err) {
      setIsScraping(false);
      console.error('Error toggling scraper:', err);
    }
  };

  const handleRemoveModel = async () => {
    const query = removeModelInput.trim();
    if (!query) return;
    if (!confirm(`Remove model data matching: "${query}"?`)) return;
    try {
      const response = await fetch('/api/motorcycles/remove-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data?.error || 'Remove failed');
        return;
      }
      setRemoveModelInput('');
      setFeedVersion((v) => v + 1);
    } catch (err) {
      console.error('Error removing model:', err);
    }
  };

  return (
    <div className="App">
      <header className="app-header">
        <div className="header-top">

        </div>
        <nav className="main-nav">
          <button
            className={`nav-button ${view === 'collections' ? 'active' : ''}`}
            onClick={handleViewCollections}
          >
            Collections
          </button>
          <button
            className={`nav-button ${view === 'history' ? 'active' : ''}`}
            onClick={() => setView('history')}
          >
            History
          </button>

          <label className="scrape-label"> -: </label>
          <div className="scrape-controls">
            <input
              type="text"
              value={scrapeBrandsInput}
              onChange={(e) => setScrapeBrandsInput(e.target.value)}
              className="scrape-input"
              placeholder="Aprilia RS,Cagiva"
            />
          </div>
          <button
            className="nav-button"
            onClick={handleScrape}
            title={isScraping ? 'Stop running scraper' : 'Refresh data from purkuosat.net'}
          >
            {isScraping ? 'Scraping....' : 'Update Data'}
          </button>
          <label className="scrape-label"> :- </label>

          <label className="scrape-label"> -: </label>
          <input
            type="text"
            value={removeModelInput}
            onChange={(e) => setRemoveModelInput(e.target.value)}
            className="scrape-input"
            placeholder="brand model name"
          />
          <button
            className="nav-button"
            onClick={handleRemoveModel}
            title="Remove one model and related parts"
          >
            Remove specific
          </button>
          <label className="scrape-label"> :- </label>
          <label className="scrape-label"> :- </label>

          <button
            className="nav-button"
            onClick={async () => {
              if (!confirm('Clear all scraped motorcycles, parts, selections and images?')) return;
              try {
                await fetch('/api/motorcycles/clear', { method: 'POST' });
                alert('Cleared');
                setFeedVersion((v) => v + 1);
              } catch (err) {
                alert('Clear failed: ' + err.message);
              }
            }}
          >
            Remove ALL
          </button>

        </nav>
      </header>

      <main className="app-main">
        <div className="search-controls-main">
          <div className="search-row">
            <div className="search-input-wrap">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="search-input"
              placeholder="brand/model, partnum, extra-info, image-name"
            />
            {searchInput && (
              <button
                type="button"
                className="search-clear-button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                title="Clear search"
              >
                x
              </button>
            )}
            </div>
            {view === 'main' && (
              <div className="search-meta-inline">
                {feedStats.parts || 0} parts • {feedStats.motorcycles || 0} motorcycles • {feedStats.brands || 0} brands
              </div>
            )}
          </div>
        </div>
        {view === 'main' && <PartsFeed key={feedVersion} query={searchInput} onStatsChange={setFeedStats} />}
        {view === 'collections' && (
          <div>
            <SelectionsSummary />
            <button className="back-button main-back" onClick={handleBackFromCollections}>
              ← Back to Parts
            </button>
          </div>
        )}
        {view === 'history' && (
          <div>
            <ChangesHistory />
            <button className="back-button main-back" onClick={() => setView('main')}>
              ← Back to Parts
            </button>
          </div>
        )}
      </main>

    </div>
  );
}

export default App;
