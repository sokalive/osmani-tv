import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Hls from 'hls.js';
import { useApp } from '../context/AppContext';
import { buildProxyUrl, pickStreamUrl } from '../lib/api';

export default function PlayerPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { channels, isPremium, openPremium } = useApp();
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  const channel = useMemo(() => {
    if (location.state?.channel) return location.state.channel;
    return (channels || []).find((c) => String(c.id) === String(id));
  }, [channels, id, location.state]);

  const premiumRequired =
    channel && String(channel.accessType || channel.access_type || 'premium').toLowerCase() !== 'free';

  useEffect(() => {
    if (!channel || (premiumRequired && !isPremium)) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    const raw = pickStreamUrl(channel);
    const isEmbed = /\.php(\?|$)/i.test(raw) || /player\.php/i.test(raw);
    if (isEmbed) return undefined;

    const src = /\.m3u8(\?|$)/i.test(raw) ? buildProxyUrl(raw) : raw || buildProxyUrl(raw);
    let hls;

    const start = async () => {
      setError('');
      try {
        if (Hls.isSupported() && /\.m3u8(\?|$)/i.test(src)) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data?.fatal) setError('Imeshindwa kucheza stream');
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = src;
        } else {
          video.src = src;
        }
        await video.play().catch(() => {});
      } catch (e) {
        setError(e?.message || 'Playback error');
      }
    };
    start();

    return () => {
      if (hls) hls.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [channel, isPremium, premiumRequired]);

  if (!channel) {
    return (
      <div className="player-page">
        <p className="muted">Channel haipatikani.</p>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
          Rudi Home
        </button>
      </div>
    );
  }

  const raw = pickStreamUrl(channel);
  const isEmbed = /\.php(\?|$)/i.test(raw) || /player\.php/i.test(raw);

  return (
    <div className="player-page">
      <div className="header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          ← Rudi
        </button>
        <strong>{channel.name}</strong>
        <span />
      </div>

      <div className="player-frame">
        {premiumRequired && !isPremium ? (
          <div className="locked-overlay">
            <div>
              <h3>Channel ya Premium</h3>
              <p className="muted">Lipia kifurushi ili kutazama.</p>
              <button type="button" className="btn btn-green" onClick={openPremium}>
                Lipia Sasa
              </button>
            </div>
          </div>
        ) : isEmbed ? (
          <iframe title={channel.name} src={raw} allow="autoplay; fullscreen; encrypted-media" allowFullScreen />
        ) : (
          <video ref={videoRef} controls playsInline autoPlay />
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
