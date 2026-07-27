import React, { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { identityPayload } from '../lib/deviceId';
import { useApp } from '../context/AppContext';

function pickOrderId(body) {
  if (!body || typeof body !== 'object') return null;
  return (
    body.order_id ||
    body.orderId ||
    body.data?.order_id ||
    body.data?.orderId ||
    null
  );
}

export default function PremiumModal() {
  const {
    premiumOpen,
    setPremiumOpen,
    plans,
    phone,
    identity,
    refreshSubscription,
    refreshPlans,
  } = useApp();
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState('plans'); // plans | waiting | success | error
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [provider, setProvider] = useState('sonicpesa');

  useEffect(() => {
    if (!premiumOpen) return;
    setStep('plans');
    setError('');
    setOrderId('');
    setBusy(false);
    refreshPlans();
    apiGet('/api/payments/checkout-providers')
      .then((cfg) => {
        const p = String(cfg?.payment_provider || cfg?.provider || 'sonicpesa').toLowerCase();
        setProvider(p.includes('aurax') ? 'auraxpay' : p.includes('zeno') ? 'zenopay' : 'sonicpesa');
      })
      .catch(() => setProvider('sonicpesa'));
  }, [premiumOpen, refreshPlans]);

  useEffect(() => {
    if (step !== 'waiting' || !orderId || !identity?.deviceId) return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const paths = [
          `/api/payments/sonicpesa/status/${encodeURIComponent(orderId)}`,
          `/api/payment-status/${encodeURIComponent(orderId)}`,
        ];
        for (const path of paths) {
          try {
            const body = await apiGet(path, { cacheBust: true });
            const st = String(body?.status || body?.payment_status || body?.state || '').toLowerCase();
            if (['success', 'paid', 'completed', 'active'].includes(st) || body?.active === true) {
              const sub = await refreshSubscription();
              if (sub?.active || !stopped) {
                setStep('success');
                return;
              }
            }
          } catch {
            /* try next */
          }
        }
        const sub = await refreshSubscription();
        if (sub?.active) setStep('success');
      } catch {
        /* keep waiting */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [step, orderId, identity, refreshSubscription]);

  if (!premiumOpen) return null;

  const close = () => setPremiumOpen(false);

  const pay = async () => {
    if (!selected || !identity?.deviceId) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...identityPayload(identity, phone),
        phone,
        plan_id: selected.id,
        planId: selected.id,
        amount: selected.price,
        provider,
        payment_provider: provider,
        client_version_code: 24,
        app_version: '1.8.2-web',
        runtime_version: '1.8.2',
      };
      const paths =
        provider === 'auraxpay'
          ? ['/api/payments/auraxpay/create-order', '/api/payments/auraxPay/create-order']
          : provider === 'zenopay'
            ? ['/api/payments/create-payment']
            : ['/api/payments/sonicpesa/create-order'];
      let body = null;
      let lastErr = null;
      for (const path of paths) {
        try {
          body = await apiPost(path, payload);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!body) throw lastErr || new Error('Imeshindwa kuanzisha malipo');
      const oid = pickOrderId(body);
      if (!oid) throw new Error('Order ID haikupatikana');
      setOrderId(String(oid));
      setStep('waiting');
    } catch (e) {
      setError(e?.message || 'Malipo yameshindikana');
      setStep('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Lipia Kifurushi</h2>
        <p className="muted">Chagua kifurushi na thibitisha malipo kwa namba yako.</p>

        {step === 'plans' && (
          <>
            <div className="plan-list">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`plan-item ${selected?.id === p.id ? 'selected' : ''}`}
                  onClick={() => setSelected(p)}
                >
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted">{p.durationDays || p.duration_days || '?'} siku</div>
                  </div>
                  <strong>TSh {Number(p.price || 0).toLocaleString()}</strong>
                </button>
              ))}
              {!plans.length && <p className="muted">Hakuna mipango kwa sasa.</p>}
            </div>
            <p className="muted">Simu: {phone || '—'}</p>
            {error && <p className="error-text">{error}</p>}
            <div className="stack-actions">
              <button type="button" className="btn btn-green btn-block" disabled={!selected || busy} onClick={pay}>
                {busy ? 'Inatuma…' : 'Lipia Sasa'}
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={close}>
                Funga
              </button>
            </div>
          </>
        )}

        {step === 'waiting' && (
          <div style={{ textAlign: 'center', padding: '20px 8px' }}>
            <div className="spinner" style={{ margin: '0 auto 14px' }} />
            <h3>Subiri USSD / PIN</h3>
            <p className="muted">Order: {orderId}</p>
            <p className="muted">Tunangalia malipo yako kiotomatiki…</p>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={close}>
              Funga
            </button>
          </div>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center', padding: '12px 8px' }}>
            <h3 style={{ color: '#4ADE80' }}>Hongera!</h3>
            <p className="muted">Kifurushi chako kimeamilishwa.</p>
            <button type="button" className="btn btn-green btn-block" onClick={close}>
              Endelea Kutazama
            </button>
          </div>
        )}

        {step === 'error' && (
          <div>
            <p className="error-text">{error}</p>
            <div className="stack-actions">
              <button type="button" className="btn btn-green btn-block" onClick={() => setStep('plans')}>
                Jaribu Tena
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={close}>
                Funga
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
