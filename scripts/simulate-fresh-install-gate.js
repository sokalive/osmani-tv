#!/usr/bin/env node
'use strict';

/**
 * Fresh-install gate simulation — proves stale-bundle gating when isEmbeddedLaunch is false.
 * Run: node scripts/simulate-fresh-install-gate.js
 */

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function rewriteRenderToCdn(url) {
  try {
    const u = new URL(url);
    if (u.host === 'osmani-admin-api.onrender.com') {
      u.host = 'osmanitv.b-cdn.net';
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return url;
}

function probeBundle({ hasStreamDirectExempt }) {
  const sample =
    'https://osmani-admin-api.onrender.com/stream-direct?token=sim';
  const resolved = hasStreamDirectExempt ? sample : rewriteRenderToCdn(sample);
  const looksLikeHls = hasStreamDirectExempt
    ? /\/stream-direct(?:\?|$)/i.test(resolved) || /\.m3u8(?:$|[?#&])/i.test(resolved)
    : /\.m3u8(?:$|[?#&])/i.test(resolved);
  const staleEmbeddedLikely = /b-cdn\.net\/stream-direct/i.test(resolved) && !looksLikeHls;
  return {
    hasStreamDirectExempt,
    staleEmbeddedLikely,
    isStale: staleEmbeddedLikely || !hasStreamDirectExempt,
  };
}

function oldGatePolicy(isEmbeddedLaunch, probe) {
  return isEmbeddedLaunch === true;
}

function newGatePolicy(isEmbeddedLaunch, probe) {
  if (probe.isStale) return true;
  if (isEmbeddedLaunch === true) return true;
  return false;
}

function oldReloadPolicy(isEmbeddedLaunch, fetchIsNew) {
  return fetchIsNew && isEmbeddedLaunch === true;
}

function newReloadPolicy(isEmbeddedLaunch, fetchIsNew, staleAtStart) {
  return fetchIsNew && (staleAtStart || isEmbeddedLaunch === true);
}

console.log('--- fresh install simulation: Play Store embedded b20bfc5 ---');
const embeddedProbe = probeBundle({ hasStreamDirectExempt: false });
console.log('  probe:', embeddedProbe);

if (!oldGatePolicy(false, embeddedProbe)) {
  pass('BUG REPRO: old gate skips when isEmbeddedLaunch=false on stale embedded (matches device report)');
} else {
  fail('old gate unexpectedly blocks stale embedded');
}

if (newGatePolicy(false, embeddedProbe)) {
  pass('new gate blocks stale embedded even when isEmbeddedLaunch=false');
} else {
  fail('new gate must block stale embedded');
}

if (!oldReloadPolicy(false, true)) {
  pass('BUG REPRO: old reload skipped after OTA fetch on isEmbeddedLaunch=false device');
} else {
  fail('old reload unexpectedly fires');
}

if (newReloadPolicy(false, true, embeddedProbe.isStale)) {
  pass('new reload fires after OTA fetch on stale session');
} else {
  fail('new reload must fire on stale session');
}

console.log('\n--- post-OTA session: stream-direct fix active ---');
const otaProbe = probeBundle({ hasStreamDirectExempt: true });
if (!newGatePolicy(false, otaProbe)) {
  pass('new gate releases after OTA bundle active');
} else {
  fail('new gate must not block fixed OTA bundle');
}

console.log('\n--- flow: install → open → OTA → reload → playback ---');
const steps = [
  { step: 'install_open', isEmbeddedLaunch: false, bundle: 'b20bfc5', fetchIsNew: null },
  { step: 'gate_blocks', isEmbeddedLaunch: false, bundle: 'b20bfc5', fetchIsNew: null },
  { step: 'ota_fetch_done', isEmbeddedLaunch: false, bundle: 'b20bfc5', fetchIsNew: true },
  { step: 'after_reload', isEmbeddedLaunch: false, bundle: 'ota', fetchIsNew: null },
];

for (const s of steps) {
  const probe =
    s.bundle === 'b20bfc5'
      ? embeddedProbe
      : otaProbe;
  const block = newGatePolicy(s.isEmbeddedLaunch, probe);
  const reload =
    s.fetchIsNew == null
      ? null
      : newReloadPolicy(s.isEmbeddedLaunch, s.fetchIsNew, probe.isStale);
  console.log(`  ${s.step}: block=${block} reload=${reload}`);
}

if (process.exitCode) process.exit(1);
console.log('\n[simulate-fresh-install-gate] ok');
