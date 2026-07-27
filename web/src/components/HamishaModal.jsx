import React, { useState } from 'react';
import { apiPost } from '../lib/api';
import { identityPayload } from '../lib/deviceId';
import { useApp } from '../context/AppContext';

export default function HamishaModal() {
  const { hamishaOpen, setHamishaOpen, identity, phone, refreshSubscription } = useApp();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  if (!hamishaOpen) return null;

  const close = () => {
    setHamishaOpen(false);
    setMsg('');
    setErr('');
    setTarget('');
  };

  const submit = async () => {
    if (!identity?.deviceId) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const body = await apiPost('/api/transfer/request', {
        ...identityPayload(identity, phone),
        from_device_id: identity.deviceId,
        to_device_id: target.trim(),
        target_device_id: target.trim(),
        targetDeviceId: target.trim(),
      });
      setMsg(body?.message || 'Ombi la Hamisha limetumwa.');
      await refreshSubscription();
    } catch (e) {
      setErr(e?.message || 'Hamisha imeshindikana');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Hamisha Kifurushi</h2>
        <p className="muted">Weka Device ID ya kifaa unachotaka kuhamia kifurushi.</p>
        <label className="field">
          <span>Device ID ya mpokeaji</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="mfano: a0629b2e…" />
        </label>
        {err && <p className="error-text">{err}</p>}
        {msg && <p style={{ color: '#4ADE80' }}>{msg}</p>}
        <div className="stack-actions">
          <button type="button" className="btn btn-yellow btn-block" disabled={!target.trim() || busy} onClick={submit}>
            {busy ? 'Inatuma…' : 'Tuma Ombi'}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={close}>
            Funga
          </button>
        </div>
      </div>
    </div>
  );
}
