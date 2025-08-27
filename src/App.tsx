import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import RoadmapPage from './RoadmapPage';
import AKSIssuesPage from './AKSIssuesPage';

const Navigation: React.FC = () => {
  const location = useLocation();
  
  return (
    <nav className="app-navigation">
      <div className="nav-container">
        <Link 
          to="/" 
          className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
        >
          Roadmap
        </Link>
        <Link 
          to="/issues" 
          className={`nav-link ${location.pathname === '/issues' ? 'active' : ''}`}
        >
          All Issues
        </Link>
      </div>
    </nav>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <div className="app">
        <Navigation />
        <Routes>
          <Route path="/" element={<RoadmapPage />} />
          <Route path="/issues" element={<AKSIssuesPage />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;