#!/usr/bin/env node
'use strict';

/**
 * VPS Play runtime 1.8.2 must not call Render when osmani-admin-api is OFF.
 * Run: node scripts/verify-vps-no-render-fallback.js
 */

const fs = require('fs');
const path = require('path');

const VPS = 'https://api.osmanitv.com';
const RENDER = 'https://osmani-admin-api.onrender.com';
const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('=== Static: VPS must not fall back to Render ===\n');

const catalogFetch = read('lib/catalogApiFetch.js');
if (catalogFetch.includes('RENDER_PRODUCTION_API_URL') || catalogFetch.includes('bases.push(RENDER')) {
  fail('catalogApiFetch still references Render production fallback for VPS');
} else {
  pass('catalogApiFetch has no VPS→Render fallback');
}

if (!catalogFetch.includes('isVpsApiTarget')) {
  fail('catalogApiFetch must use isVpsApiTarget');
} else {
  pass('catalogApiFetch gates legacy fallback with isVpsApiTarget');
}

const apiBase = read('lib/apiBaseUrl.js');
const playVps = read('lib/playVpsApiHost.js');
if (!apiBase.includes('forcedPlayVpsApiBaseUrl') || !playVps.includes('PLAY_OTA_MIN_VERSION_CODE = 16')) {
  fail('apiBaseUrl must force VPS from native versionCode >= 16 (OTA migration)');
} else {
  pass('apiBaseUrl forces VPS for Play versionCode >= 16');
}

if (!playVps.includes('nativeBuildVersion')) {
  fail('playVpsApiHost must read Application.nativeBuildVersion');
} else {
  pass('playVpsApiHost uses nativeBuildVersion');
}

if (!read('lib/otaBootGatePolicy.js').includes('isStaleApiHostBundle')) {
  fail('otaBootGatePolicy must force OTA when API host still Render on Play VPS');
} else {
  pass('OTA gate detects stale Render API routing');
}

const appConfig = read('app.config.js');
if (!appConfig.includes('apiBaseUrl: manifestApiBaseUrl')) {
  fail('app.config.js must embed extra.apiBaseUrl for native manifest');
} else {
  pass('app.config.js embeds extra.apiBaseUrl');
}

(async () => {
  console.log('\n=== Live: VPS runtime 1.8.2 with Render OFF ===\n');

  try {
    const renderRes = await fetch(`${RENDER}/api/health`, { signal: AbortSignal.timeout(8000) }).catch(
      () => null,
    );
    if (renderRes?.ok) {
      console.warn('WARN: Render still responds — VPS app must not call it');
    } else {
      pass(`Render unreachable or non-OK (HTTP ${renderRes?.status ?? 'network'}) — expected when OFF`);
    }
  } catch {
    pass('Render unreachable (expected when OFF)');
  }

  const endpoints = [
    { name: 'channels', url: `${VPS}/api/channels`, method: 'GET' },
    { name: 'subscription/verify', url: `${VPS}/api/subscription/verify`, method: 'POST', body: { device_id: 'vps-no-render-probe', device_fingerprint: 'probe' } },
    { name: 'checkout-providers', url: `${VPS}/api/payments/checkout-providers`, method: 'GET' },
    { name: 'update-check', url: `${VPS}/api/update-check?platform=android&package=com.burudanitv.app&version_code=24&version_name=1.8.2`, method: 'GET' },
    { name: 'health', url: `${VPS}/api/health`, method: 'GET' },
  ];

  for (const ep of endpoints) {
    const res = await fetch(ep.url, {
      method: ep.method,
      headers: { Accept: 'application/json', ...(ep.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(ep.body ? { body: JSON.stringify(ep.body) } : {}),
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    if (res.status === 503) {
      fail(`${ep.name}: HTTP 503 from VPS — ${text.slice(0, 120)}`);
      continue;
    }
    if (!res.ok) {
      fail(`${ep.name}: HTTP ${res.status}`);
      continue;
    }
    pass(`${ep.name}: HTTP ${res.status} via ${VPS}`);
  }

  const channelsRes = await fetch(`${VPS}/api/channels`);
  const channels = await channelsRes.json().catch(() => null);
  if (!Array.isArray(channels) || channels.length === 0) {
    fail('channels empty');
  } else {
    pass(`channels count ${channels.length}`);
  }

  const verifyRes = await fetch(`${VPS}/api/subscription/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: 'vps-no-render-probe', device_fingerprint: 'probe' }),
  });
  const verifyBody = await verifyRes.json().catch(() => null);
  if (verifyRes.status === 503) {
    fail('subscription verify returned 503');
  } else if (verifyRes.ok && verifyBody && typeof verifyBody === 'object') {
    pass('subscription verify returns JSON (active may be false for probe device)');
  } else {
    fail(`subscription verify unexpected HTTP ${verifyRes.status}`);
  }

  if (!process.exitCode) {
    console.log('\n[verify-vps-no-render-fallback] ok — runtime 1.8.2 / VPS only');
  }
})().catch((e) => {
  fail(e?.message ?? String(e));
});
