#!/usr/bin/env node
'use strict';

/**
 * Production-like manual subscription receipt harness.
 * Opens /api/subscription-stream, optionally triggers admin grant, measures T0→T6.
 *
 * Usage:
 *   node scripts/harness-manual-subscription-receipt.js
 *   DEVICE_ID=77e706bfba962406 node scripts/harness-manual-subscription-receipt.js
 *   LIVE_GRANT=1 DEVICE_ID=... ADMIN_TOKEN=... ADMIN_PIN=... node scripts/harness-manual-subscription-receipt.js
 *
 * LIVE_GRANT=1 posts a 1-day test grant (production) — use only on designated test devices.
 */


const fs = require('fs');
const path = require('path');

const VPS = (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');
const DEVICE_ID = String(process.env.DEVICE_ID || '77e706bfba962406').trim();
const WAKE_COALESCE_MS = 80;
const LISTEN_MS = Number(process.env.LISTEN_MS || 45000);
const LIVE_GRANT = process.env.LIVE_GRANT === '1';
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || process.env.APP_UPDATE_ADMIN_TOKEN || '').trim();
const ADMIN_PIN = String(process.env.ADMIN_PIN || process.env.SECURITY_PIN || '').trim();

const WAKE_EVENTS = new Set([
  'manual_gift',
  'subscription_wake',
  'subscription_manual_grant',
  'manual_subscription_granted',
  'device_subscription',
  'device_subscription_updated',
  'device_subscription_granted',
  'subscription_granted',
  'subscription_activated',
  'subscription_changed',
  'subscription_updated',
]);

function mask(id) {
  const s = String(id || '');
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
}

function stats(label, arr) {
  if (!arr.length) return { label, n: 0 };
  return {
    label,
    n: arr.length,
    min: Math.min(...arr),
    median: pct(arr, 50),
    p95: pct(arr, 95),
    max: Math.max(...arr),
  };
}

function normalizeVerify(body) {
  const mg = body?.manualGift || body?.manual_gift || {};
  const active = body?.active === true || body?.isActive === true;
  const showPopup = mg.showPopup === true || body?.manualGiftShowPopup === true;
  const ack =
    body?.manualGiftAckKey ??
    body?.manual_gift_ack_key ??
    (showPopup && mg.grantId != null ? String(mg.grantId) : null);
  return {
    active,
    playbackAllowed: body?.playbackAllowed === true,
    manualGiftAckKey: ack,
    manualGiftShowPopup: showPopup,
    grantId: mg.grantId ?? null,
    expiresAt: body?.expiresAt ?? body?.expires_at ?? null,
    source: body?.source ?? null,
  };
}

async function verifyDevice(deviceId) {
  const t0 = Date.now();
  const res = await fetch(`${VPS}/api/subscription/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
    signal: AbortSignal.timeout(25000),
  });
  const body = await res.json();
  const ms = Date.now() - t0;
  const normalized = normalizeVerify(body);
  return { ms, body, normalized, httpStatus: res.status };
}

async function postAdminGrant(deviceId) {
  if (!ADMIN_TOKEN || !ADMIN_PIN) {
    throw new Error('LIVE_GRANT requires ADMIN_TOKEN and ADMIN_PIN');
  }
  const t0 = Date.now();
  const res = await fetch(`${VPS}/api/admin/manual-subscription/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({
      device_id: deviceId,
      duration_days: 1,
      pin: ADMIN_PIN,
      security_pin: ADMIN_PIN,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  return { t0, ms: Date.now() - t0, status: res.status, body };
}

function parseSseBlocks(buffer) {
  const events = [];
  const parts = buffer.split('\n\n');
  for (const block of parts) {
    if (!block.trim()) continue;
    const event = (block.match(/^event:\s*(.+)$/m) || [])[1]?.trim() || 'message';
    const dataLine = (block.match(/^data:\s*(.+)$/m) || [])[1] || '';
    let data = dataLine;
    try {
      data = JSON.parse(dataLine);
    } catch {
      /* raw */
    }
    events.push({ event, data });
  }
  return events;
}

async function listenSse(deviceId, sinceMs) {
  const url = `${VPS}/api/subscription-stream?device_id=${encodeURIComponent(deviceId)}`;
  const ctrl = new AbortController();
  const wakeHits = [];
  let tConnect = null;

  const readerPromise = (async () => {
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: ctrl.signal,
    });
    tConnect = Date.now() - sinceMs;
    if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop() || '';
      for (const block of chunks) {
        for (const ev of parseSseBlocks(block + '\n\n')) {
          const t = Date.now() - sinceMs;
          if (WAKE_EVENTS.has(ev.event)) {
            wakeHits.push({ t, event: ev.event, data: ev.data });
          }
        }
      }
    }
  })();

  await new Promise((r) => setTimeout(r, LISTEN_MS));
  ctrl.abort();
  try {
    await readerPromise;
  } catch {
    /* expected abort */
  }
  return { tConnect, wakeHits };
}

async function runIteration(iter) {
  const trace = { iter, deviceMasked: mask(DEVICE_ID), timestamps: {} };
  const tSession = Date.now();

  const ssePromise = listenSse(DEVICE_ID, tSession);

  let t0 = null;
  if (LIVE_GRANT) {
    const grant = await postAdminGrant(DEVICE_ID);
    t0 = grant.t0;
    trace.timestamps.T0_admin_grant = t0;
    trace.grant = { status: grant.status, ok: grant.body?.ok, grantId: grant.body?.grantId ?? grant.body?.id };
    if (grant.status >= 400) {
      trace.error = grant.body;
      return trace;
    }
  } else {
    t0 = tSession;
    trace.timestamps.T0_session_start = t0;
    trace.note = 'no_live_grant — measuring SSE connect + verify only';
  }

  const { tConnect, wakeHits } = await ssePromise;
  trace.sseConnectMs = tConnect;
  if (wakeHits.length) {
    const first = wakeHits[0];
    trace.timestamps.T3_sse_wake = tSession + first.t;
    trace.wakeEvent = { name: first.event, summary: summarizePayload(first.data) };
    trace.allWakeEvents = wakeHits.map((w) => w.event);
  }

  await new Promise((r) => setTimeout(r, WAKE_COALESCE_MS));
  const verify = await verifyDevice(DEVICE_ID);
  const t4 = Date.now();
  trace.timestamps.T4_verify_complete = t4;
  trace.verify = {
    ms: verify.ms,
    httpStatus: verify.httpStatus,
    active: verify.normalized?.active === true,
    playbackAllowed: verify.body?.playbackAllowed === true,
    manualGiftAckKey: verify.normalized?.manualGiftAckKey ?? null,
    manualGiftShowPopup: verify.normalized?.manualGiftShowPopup === true,
    grantId: verify.body?.manualGift?.grantId ?? null,
    premiumUnlock: verify.normalized?.active === true,
    paymentModalSuppressed: verify.normalized?.active === true,
    hongeraEligible:
      verify.normalized?.active === true && verify.normalized?.manualGiftShowPopup === true,
  };

  if (t0) {
    if (trace.timestamps.T3_sse_wake) {
      trace.latency = {
        T3_minus_T2_proxy_ms: trace.timestamps.T3_sse_wake - t0,
        T4_minus_T3_ms: t4 - trace.timestamps.T3_sse_wake,
        T4_minus_T0_ms: t4 - t0,
        T5_popup_eligible_minus_T4_ms: 0,
        T6_premium_ready_minus_T0_ms: trace.verify.active ? t4 - t0 : null,
      };
    } else {
      trace.latency = {
        sse_connect_ms: tConnect,
        verify_ms: verify.ms,
        T4_minus_T0_ms: t4 - t0,
      };
    }
  }

  return trace;
}

function summarizePayload(data) {
  if (!data || typeof data !== 'object') return String(data ?? '').slice(0, 120);
  return {
    requires_verify: data.requires_verify,
    grantId: data.grantId ?? data.manualGift?.grantId,
    showPopup: data.manualGift?.showPopup,
    isActive: data.isActive ?? data.active,
  };
}

(async () => {
  const iterations = Number(process.env.ITERATIONS || 1);
  const results = [];
  for (let i = 0; i < iterations; i += 1) {
    results.push(await runIteration(i + 1));
    if (i + 1 < iterations) await new Promise((r) => setTimeout(r, 500));
  }

  const t3t0 = results.map((r) => r.latency?.T3_minus_T2_proxy_ms).filter(Number.isFinite);
  const t4t0 = results.map((r) => r.latency?.T4_minus_T0_ms).filter(Number.isFinite);
  const verifyMs = results.map((r) => r.verify?.ms).filter(Number.isFinite);

  const report = {
    timestamp: new Date().toISOString(),
    testType: LIVE_GRANT ? 'integration_harness_live_grant' : 'integration_harness_sse_verify',
    vpsCommit: (await fetch(`${VPS}/api/health`).then((r) => r.json())).commit,
    deviceMasked: mask(DEVICE_ID),
    liveGrant: LIVE_GRANT,
    iterations: results,
    aggregates: {
      T3_minus_T0: stats('T3-T0', t3t0),
      T4_minus_T0: stats('T4-T0', t4t0),
      verify_ms: stats('verify', verifyMs),
    },
  };

  const out = path.join(__dirname, '..', 'manual-subscription-receipt-harness.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('\n[wrote]', out);
})();
