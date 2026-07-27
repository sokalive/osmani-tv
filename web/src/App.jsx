import React from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import PremiumModal from './components/PremiumModal';
import HamishaModal from './components/HamishaModal';
import PhoneGateModal from './components/PhoneGateModal';
import HomePage from './pages/HomePage';
import AccountPage from './pages/AccountPage';
import PlayerPage from './pages/PlayerPage';

function Shell() {
  const location = useLocation();
  const hideNav = location.pathname.startsWith('/player');

  return (
    <div className="app-shell">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sports" element={<HomePage forcedFilter="Sports" />} />
          <Route path="/tamthilia" element={<HomePage forcedFilter="Tamthilia" />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/player/:id" element={<PlayerPage />} />
        </Routes>
      </main>

      {!hideNav && (
        <nav className="bottom-nav" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="icon">🏠</span>
            Home
          </NavLink>
          <NavLink to="/sports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="icon">⚽</span>
            Sports
          </NavLink>
          <NavLink to="/tamthilia" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="icon">🎬</span>
            Tamthilia
          </NavLink>
          <NavLink to="/account" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="icon">👤</span>
            Akaunti
          </NavLink>
        </nav>
      )}

      <PremiumModal />
      <HamishaModal />
      <PhoneGateModal />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
