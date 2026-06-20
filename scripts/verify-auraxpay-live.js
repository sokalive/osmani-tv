#!/usr/bin/env node
'use strict';

/**
 * Live AuraxPay probe for VPS runtime 1.8.2 verification.
 * Run: node scripts/verify-auraxpay-live.js
 */

const VPS = 'https://api.osmanitv.com';
const RENDER = 'https://osmani-admin-api.onrender.com';
const {
  extractPaymentBackendReason,
  formatCheckoutPaymentError,
} = require('../lib/paymentCheckoutErrors');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

async function getJson(base, path) {
  const url = `${base}${path}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { url, status: res.status, parsed, text: text.slice(0, 120) };
}

/** Inline parse (avoid ESM mediaDelivery import chain). */
function parseLiveCheckout(body) {
  const auraxpay = Boolean(body?.auraxpay);
  const payment_provider = String(body?.payment_provider ?? 'zenopay').toLowerCase();
  const active =
    payment_provider === 'auraxpay' && auraxpay
      ? 'auraxpay'
      : payment_provider === 'sonicpesa' && body?.sonicpesa
        ? 'sonicpesa'
        : payment_provider;
  return { payment_provider: active, auraxpay, auraxpay_test: Boolean(body?.auraxpay_test) };
}

(async () => {
  console.log('=== Runtime 1.8.2 / VPS checkout-providers ===\n');
  const vpsCp = await getJson(VPS, '/api/payments/checkout-providers');
  if (vpsCp.status !== 200 || !vpsCp.parsed?.ok) {
    fail(`VPS checkout-providers HTTP ${vpsCp.status}`);
  } else {
    const cfg = parseLiveCheckout(vpsCp.parsed);
    pass(`VPS checkout-providers: provider=${vpsCp.parsed.payment_provider}, auraxpay=${vpsCp.parsed.auraxpay}, test=${vpsCp.parsed.auraxpay_test}`);
    if (vpsCp.parsed.auraxpay !== true) {
      fail('VPS auraxpay flag expected true when admin says Live');
    } else {
      pass('VPS auraxpay=true (admin Live confirmed by API)');
    }
    if (cfg.payment_provider !== 'auraxpay') {
      fail(`VPS active provider expected auraxpay, got ${cfg.payment_provider}`);
    } else {
      pass('VPS routes checkout to auraxpay');
    }
  }

  const endpoint = '/api/payments/auraxpay/create-order';
  pass(`App Aurax endpoint: POST ${endpoint}`);

  // Safe probe: invalid plan — confirms route exists without completing STK.
  const probeRes = await fetch(`${VPS}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      phone: '255712345678',
      plan_id: 99999,
      planId: 99999,
      amount: 3000,
      device_id: 'verify-aurax-live-probe',
      deviceId: 'verify-aurax-live-probe',
      device_fingerprint: 'probe',
      deviceFingerprint: 'probe',
    }),
  });
  const probeBody = await probeRes.json().catch(() => ({}));
  if (probeRes.status === 404) {
    fail(`VPS ${endpoint} returned 404 — wrong path`);
  } else {
    pass(`VPS ${endpoint} reachable (HTTP ${probeRes.status}, not 404)`);
  }

  const backendReason = extractPaymentBackendReason(probeBody, probeRes.status);
  pass(`Backend reason sample: ${backendReason.slice(0, 80)}`);

  // Simulate live Aurax gateway misconfig body (observed on VPS when plan is valid).
  const liveGatewayBody = {
    error: 'Endpoint not found',
    providerMessage: 'Endpoint not found',
    providerError: { error: 'Endpoint not found' },
    apiStyle: 'aurax',
    httpStatus: 404,
  };
  const userMsg = formatCheckoutPaymentError(
    extractPaymentBackendReason(liveGatewayBody, 502),
    { httpStatus: 502, provider: 'auraxpay', body: liveGatewayBody },
  );
  if (/haipatikani kwa sasa/i.test(userMsg) && !/usanidi/i.test(userMsg)) {
    fail('502 Endpoint not found must not map to generic "haipatikani" (misleading when admin Live)');
  } else {
    pass('502 Aurax gateway error maps to usanidi/seva message (not "feature off")');
  }
  if (/Endpoint not found/i.test(userMsg)) {
    fail('Raw Endpoint not found must not appear in user message');
  } else {
    pass('User message hides raw English gateway text');
  }
  console.log(`  userMsg: ${userMsg}`);

  for (const base of [RENDER]) {
    const label = 'Render';
    const cp = await getJson(base, '/api/payments/checkout-providers');
    if (cp.status !== 200 || !cp.parsed?.ok) {
      fail(`${label} checkout-providers HTTP ${cp.status}`);
    } else {
      pass(`${label} checkout-providers ok (provider=${cp.parsed.payment_provider}, auraxpay=${cp.parsed.auraxpay})`);
    }
  }

  if (!process.exitCode) {
    console.log('\n[verify-auraxpay-live] ok — VPS runtime 1.8.2 evidence collected');
  }
})().catch((e) => {
  fail(e?.message ?? String(e));
});
