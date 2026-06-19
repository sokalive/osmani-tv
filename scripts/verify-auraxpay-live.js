#!/usr/bin/env node
'use strict';

/**
 * Read-only live probe: checkout-providers + route presence (OPTIONS/GET only).
 * Run: node scripts/verify-auraxpay-live.js
 */

const VPS = 'https://api.osmanitv.com';
const RENDER = 'https://osmani-admin-api.onrender.com';

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

(async () => {
  for (const base of [VPS, RENDER]) {
    const label = base.includes('osmanitv.com') ? 'VPS' : 'Render';
    const cp = await getJson(base, '/api/payments/checkout-providers');
    if (cp.status !== 200 || !cp.parsed?.ok) {
      fail(`${label} checkout-providers HTTP ${cp.status}`);
    } else {
      pass(`${label} checkout-providers ok (provider=${cp.parsed.payment_provider}, auraxpay=${cp.parsed.auraxpay})`);
    }

    const health = await getJson(base, '/api/health');
    if (health.status !== 200) {
      fail(`${label} health HTTP ${health.status}`);
    } else {
      pass(`${label} health ok`);
    }
  }

  if (!process.exitCode) {
    console.log('\n[verify-auraxpay-live] ok (read-only GET)');
  }
})().catch((e) => {
  fail(e?.message ?? String(e));
});
