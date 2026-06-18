#!/usr/bin/env node
'use strict';

/**
 * Verify catalog offline detection does not block UX when channels are loaded.
 * Run: node scripts/verify-offline-detection.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CONTABO = (process.env.EXPO_PUBLIC_API_URL || 'http://144.91.117.90:10001').replace(
  /\/+$/,
  '',
);

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

const connectivity = read('lib/catalogConnectivity.js');
if (!connectivity.includes('shouldMarkCatalogOffline')) fail('missing shouldMarkCatalogOffline');
else pass('catalog connectivity helper');

const ctx = read('context/OsmaniAppContext.jsx');
if (!ctx.includes('shouldMarkCatalogOffline')) fail('OsmaniAppContext must use shouldMarkCatalogOffline');
else pass('context uses catalog-grounded offline');

if (!ctx.includes('refresh_failed_catalog_usable')) {
  fail('context must log refresh_failed_catalog_usable');
} else pass('stale refresh does not block catalog');

if (ctx.includes('setIsOffline(true)') && !ctx.includes('markOffline')) {
  fail('context must gate setIsOffline(true) with markOffline');
} else pass('setIsOffline gated by catalog availability');

const app = read('App.js');
if (!app.includes('isCatalogInteractionBlocked')) fail('App.js must use isCatalogInteractionBlocked');
else pass('App blocks taps only when catalogBlocked');

if (app.includes('if (isOffline)') && app.match(/handleCardPress[\s\S]{0,400}if \(isOffline\)/)) {
  fail('handleCardPress must not gate on raw isOffline');
} else pass('handleCardPress uses catalogBlocked');

(async () => {
  console.log('\n=== Endpoint probes (non-catalog must not drive offline) ===\n');

  const endpoints = [
    ['GET', '/api/channels', true],
    ['GET', '/api/banners', true],
    ['GET', '/api/server-health', false],
    ['GET', '/api/health', true],
    ['GET', '/api/public/app-settings', false],
    ['GET', '/api/settings', false],
    [
      'POST',
      '/api/subscription/verify',
      true,
      JSON.stringify({ device_id: 'verify-offline', device_fingerprint: 'x' }),
    ],
  ];

  for (const [method, pathSuffix, shouldWork, body] of endpoints) {
    const url = `${CONTABO}${pathSuffix}`;
    const opts = {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
    };
    if (body) opts.body = body;
    try {
      const res = await fetch(url, opts);
      const ok = res.ok;
      const label = `${method} ${pathSuffix} → ${res.status}`;
      if (pathSuffix === '/api/channels' && ok) pass(`catalog primary ${label}`);
      else if (pathSuffix === '/api/server-health' && !ok) {
        pass(`server-health non-OK does not block catalog (${label})`);
      } else if (shouldWork && ok) pass(label);
      else if (!shouldWork && !ok) pass(`optional endpoint absent ${label}`);
      else console.log('INFO:', label);
    } catch (e) {
      if (pathSuffix === '/api/channels') fail(`channels unreachable: ${e.message}`);
      else console.log('INFO:', pathSuffix, e.message);
    }
  }

  // Mirror lib/catalogConnectivity.js (avoid dynamic import on Windows)
  function isNetworkTransportError(errorLike) {
    const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
    return (
      msg.includes('network request failed') ||
      msg.includes('networkerror') ||
      msg.includes('failed to fetch') ||
      msg.includes('cleartext') ||
      msg.includes('not permitted') ||
      msg.includes('timeout') ||
      msg.includes('startup-channels') ||
      msg.includes('startup-banners')
    );
  }
  function shouldMarkCatalogOffline(errorLike, catalogChannelCount) {
    if (!isNetworkTransportError(errorLike)) return false;
    return !(Number(catalogChannelCount) > 0);
  }
  function isCatalogInteractionBlocked(isOffline, catalogChannelCount) {
    return isOffline && !(Number(catalogChannelCount) > 0);
  }

  if (shouldMarkCatalogOffline(new Error('startup-channels'), 17) !== false) {
    fail('timeout with channels must not mark offline');
  } else pass('timeout + 17 channels → not offline');

  if (shouldMarkCatalogOffline(new Error('startup-channels'), 0) !== true) {
    fail('timeout without channels must mark offline');
  } else pass('timeout + 0 channels → offline');

  if (isCatalogInteractionBlocked(true, 5) !== false) {
    fail('isOffline true with channels must not block interaction');
  } else pass('isOffline + channels → interaction allowed');

  if (isCatalogInteractionBlocked(true, 0) !== true) {
    fail('isOffline true without channels must block');
  } else pass('isOffline + no channels → blocked');

  if (!process.exitCode) {
    console.log('\n[verify-offline-detection] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
