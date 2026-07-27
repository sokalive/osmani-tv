import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function PhoneGateModal() {
  const { phoneGateOpen, setPhoneGateOpen, setPhone, openPremium } = useApp();
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');

  if (!phoneGateOpen) return null;

  const save = async () => {
    const cleaned = value.replace(/\s+/g, '');
    if (!/^(\+?255|0)?[0-9]{9,12}$/.test(cleaned)) {
      setErr('Weka namba sahihi ya simu (Tanzania)');
      return;
    }
    await setPhone(cleaned);
    setPhoneGateOpen(false);
    openPremium();
  };

  return (
    <div className="modal-backdrop" onClick={() => setPhoneGateOpen(false)}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Namba ya Simu</h2>
        <p className="muted">Inahitajika ili kuendelea na malipo na akaunti yako.</p>
        <label className="field">
          <span>Simu</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="07XXXXXXXX"
            inputMode="tel"
          />
        </label>
        {err && <p className="error-text">{err}</p>}
        <div className="stack-actions">
          <button type="button" className="btn btn-green btn-block" onClick={save}>
            Endelea
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setPhoneGateOpen(false)}>
            Baadaye
          </button>
        </div>
      </div>
    </div>
  );
}
