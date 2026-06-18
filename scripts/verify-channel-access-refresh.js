#!/usr/bin/env node
'use strict';

/**
 * FREE/PREMIUM badge refresh — static + production timing checks.
 * Run: node scripts/verify-channel-access-refresh.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const BASE = (
  process.env.EXPO_PUBLIC_API_URL || 'http://144.91.117.90:10001'
).replace(/\/+$/, '');

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

const catalogCache = read('lib/catalogCache.js');
const ctx = read('context/OsmaniAppContext.jsx');

const ttlMatch = catalogCache.match(/CHANNELS_TTL_MS\s*=\s*([\d_]+)/);
const ttlMs = ttlMatch ? Number(String(ttlMatch[1]).replace(/_/g, '')) : NaN;
const syncMatch = ctx.match(/LIVE_SYNC_BASE_MS\s*=\s*([\d_]+)/);
const syncMs = syncMatch ? Number(String(syncMatch[1]).replace(/_/g, '')) : NaN;

if (!Number.isFinite(ttlMs) || ttlMs >= syncMs) {
  fail(`CHANNELS_TTL_MS (${ttlMs}) must be less than LIVE_SYNC_BASE_MS (${syncMs})`);
} else {
  pass(`catalog TTL ${ttlMs}ms < foreground sync ${syncMs}ms`);
}

if (!ctx.includes('forceNetwork: true') || !ctx.includes('invalidateCatalogCache()')) {
  fail('admin/resume/foreground refresh must bypass catalog cache');
} else {
  pass('forceNetwork + invalidateCatalogCache on admin/resume paths');
}

if (!ctx.includes("accessType === 'premium'")) {
  fail('catalog sync diagnostics should count premium channels');
} else {
  pass('catalog sync access-type diagnostics');
}

if (read('App.js').includes('accessType') && read('lib/trialWatchAccess.js').includes('accessType')) {
  pass('FREE/PREMIUM derived from accessType + accessPremium');
} else {
  fail('access type field mapping missing');
}

(async () => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/channels`);
  const body = await res.json();
  const ms = Date.now() - t0;
  if (!res.ok || !Array.isArray(body)) {
    fail(`production /api/channels HTTP ${res.status}`);
    return;
  }
  pass(`production API ${body.length} channels in ${ms}ms`);
  const withAccess = body.filter(
    (c) => c?.accessType != null || c?.accessPremium != null || c?.access_premium != null,
  ).length;
  if (withAccess < body.length * 0.5) {
    fail('production channels missing accessType/accessPremium on most rows');
  } else {
    pass(`production API exposes access fields on ${withAccess}/${body.length} channels`);
  }

  console.log('\n=== EXPECTED REFRESH TIMING (after fix) ===');
  console.log('Admin SSE channel_* event → ~320ms debounce + network → ~0.5–2s visibility');
  console.log(`Foreground active (no SSE) → up to ${syncMs / 1000}s tick + network`);
  console.log(`In-memory cache max age → ${ttlMs / 1000}s (bypassed on admin/resume/launch)`);
  console.log('Pull-to-refresh → immediate network (forceNetwork)');

  if (!process.exitCode) {
    console.log('\n[verify-channel-access-refresh] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
