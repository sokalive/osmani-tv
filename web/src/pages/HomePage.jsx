import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BannerCarousel from '../components/BannerCarousel';
import { useApp } from '../context/AppContext';
import { channelCategory, channelThumbnail } from '../lib/api';
import { FILTER_VISUAL } from '../lib/theme';

const FILTERS = ['Zote', 'Trending', 'Sports', 'Tamthilia'];

export default function HomePage({ forcedFilter = null }) {
  const { channels, banners, loadingCatalog, catalogError, refreshCatalog, isPremium, openPremium } =
    useApp();
  const [filter, setFilter] = useState(forcedFilter || 'Zote');
  const navigate = useNavigate();
  const activeFilter = forcedFilter || filter;

  const filtered = useMemo(() => {
    const list = channels || [];
    if (activeFilter === 'Zote') return list;
    if (activeFilter === 'Trending') {
      return list.filter((c) => c.isPopular || c.popular || c.trending || channelCategory(c).includes('trend'));
    }
    if (activeFilter === 'Sports') {
      return list.filter((c) => {
        const cat = channelCategory(c);
        return cat.includes('sport') || cat.includes('michezo') || /sport|bein|azam|super/i.test(c.name || '');
      });
    }
    if (activeFilter === 'Tamthilia') {
      return list.filter((c) => {
        const cat = channelCategory(c);
        return cat.includes('tamthilia') || cat.includes('drama') || cat.includes('film') || cat.includes('movie');
      });
    }
    return list;
  }, [channels, activeFilter]);

  const openChannel = (ch) => {
    const premium = String(ch.accessType || ch.access_type || '').toLowerCase() !== 'free';
    if (premium && !isPremium) {
      openPremium();
      return;
    }
    navigate(`/player/${ch.id}`, { state: { channel: ch } });
  };

  return (
    <div>
      <div className="header">
        <div className="brand">
          <img src="/icon.png" alt="" />
          <span>Osmani TV</span>
        </div>
        <button type="button" className="btn btn-ghost" onClick={refreshCatalog}>
          Onyesha upya
        </button>
      </div>

      <BannerCarousel banners={banners} />

      {!forcedFilter && (
        <div className="filter-row">
          {FILTERS.map((f) => {
            const visual = FILTER_VISUAL[f];
            const selected = activeFilter === f;
            return (
              <button
                key={f}
                type="button"
                className={`filter-pill ${selected ? 'selected' : ''}`}
                style={{
                  background: selected ? visual.selected : visual.colors,
                  boxShadow: selected ? `0 4px 18px ${visual.glow}55` : undefined,
                }}
                onClick={() => setFilter(f)}
              >
                <span>{visual.icon}</span>
                {f}
              </button>
            );
          })}
        </div>
      )}

      <h2 className="section-title">
        {activeFilter === 'Sports' ? 'Michezo' : activeFilter === 'Tamthilia' ? 'Tamthilia' : 'Chaneli'}
      </h2>

      {loadingCatalog && (
        <div className="status-row">
          <div className="spinner" />
          <span>Inapakia chaneli…</span>
        </div>
      )}
      {catalogError && <p className="error-text">{catalogError}</p>}

      <div className="channel-grid">
        {filtered.map((ch) => (
          <button key={ch.id} type="button" className="channel-card" onClick={() => openChannel(ch)}>
            <div className="channel-thumb">
              {channelThumbnail(ch) ? (
                <img src={channelThumbnail(ch)} alt="" loading="lazy" />
              ) : (
                <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#94a3b8' }}>
                  {(ch.name || '?').slice(0, 1)}
                </div>
              )}
              {(ch.isLive || ch.is_live) && <span className="badge">LIVE</span>}
            </div>
            <div className="channel-meta">{ch.name}</div>
          </button>
        ))}
      </div>

      {!loadingCatalog && !filtered.length && (
        <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
          Hakuna chaneli katika kategoria hii.
        </p>
      )}
    </div>
  );
}
