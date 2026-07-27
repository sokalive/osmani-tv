import React, { useState } from 'react';
import ProfileAvatar from '../components/ProfileAvatar';
import { useApp } from '../context/AppContext';

function formatExpiry(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB');
  } catch {
    return String(iso);
  }
}

export default function AccountPage() {
  const {
    identity,
    phone,
    setPhone,
    subscription,
    openPremium,
    setHamishaOpen,
    refreshSubscription,
  } = useApp();
  const [phoneDraft, setPhoneDraft] = useState(phone || '');
  const [copied, setCopied] = useState(false);
  const deviceId = identity?.deviceId || '…';

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div className="header">
        <h1 style={{ margin: 0, fontSize: 22 }}>Akaunti Yangu</h1>
      </div>

      <div className="card account-hero">
        <ProfileAvatar seed={deviceId} size={64} />
        <div>
          <div style={{ fontWeight: 800 }}>Osmani TV</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            ID: {deviceId.slice(0, 8)}…
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 8, padding: '6px 10px' }} onClick={copyId}>
            {copied ? 'Imenakiliwa' : 'Nakili ID'}
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-box">
          <div className="label">Malipo / Bei</div>
          <div className="value">
            {subscription?.price != null
              ? `TSh ${Number(subscription.price).toLocaleString()}`
              : subscription?.planName || (subscription?.active ? 'Hai' : 'Hakuna')}
          </div>
        </div>
        <div className="stat-box">
          <div className="label">Hali</div>
          <div className="value" style={{ color: subscription?.active ? '#4ADE80' : '#FCA5A5' }}>
            {subscription?.active ? 'Active' : 'Haipo'}
          </div>
        </div>
        <div className="stat-box">
          <div className="label">Mwisho</div>
          <div className="value">{formatExpiry(subscription?.expiresAt)}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <label className="field">
          <span>Namba ya simu</span>
          <input value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} placeholder="07XXXXXXXX" />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => setPhone(phoneDraft)}
        >
          Hifadhi Simu
        </button>
      </div>

      <div className="stack-actions">
        <button type="button" className="btn btn-green btn-block" onClick={openPremium}>
          Lipia / Sasisha Kifurushi
        </button>
        <button type="button" className="btn btn-yellow btn-block" onClick={() => setHamishaOpen(true)}>
          Hamisha Kifurushi
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={refreshSubscription}>
          Thibitisha / Verify
        </button>
      </div>
    </div>
  );
}
