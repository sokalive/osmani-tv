#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for Admin→App freshness + payment red UI markers.
 * Run: node scripts/verify-admin-app-freshness.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const ctx = read('context/OsmaniAppContext.jsx');
const cache = read('lib/catalogCache.js');
const realtime = read('lib/realtimeSync.js');
const theme = read('lib/paymentFlowTheme.js');
const modal = read('components/PremiumModal.js');
const waiting = read('components/PaymentWaitingStep.js');
const media = read('lib/mediaDelivery.js');

const syncMatch = ctx.match(/LIVE_SYNC_BASE_MS\s*=\s*([\d_]+)/);
const syncMs = syncMatch ? Number(String(syncMatch[1]).replace(/_/g, '')) : NaN;
if (!Number.isFinite(syncMs) || syncMs > 10000) {
  fail(`LIVE_SYNC_BASE_MS must be <= 10000 (got ${syncMs})`);
} else pass(`LIVE_SYNC_BASE_MS = ${syncMs}ms`);

if (syncMs === 30000) fail('30s LIVE_SYNC still present');
else pass('30-second catalog poll removed');

const ttlMatch = cache.match(/CHANNELS_TTL_MS\s*=\s*([\d_]+)/);
const ttlMs = ttlMatch ? Number(String(ttlMatch[1]).replace(/_/g, '')) : NaN;
if (!Number.isFinite(ttlMs) || ttlMs >= syncMs) {
  fail(`CHANNELS_TTL_MS (${ttlMs}) must be < LIVE_SYNC_BASE_MS (${syncMs})`);
} else pass(`CHANNELS_TTL_MS ${ttlMs}ms < sync ${syncMs}ms`);

if (!ctx.includes('sseFrameLooksLikeCatalogChange')) fail('catalog SSE classifier missing');
else pass('catalog SSE classifier present');

if (!ctx.includes("subscribeRealtimeEvent('*'")) fail('catch-all SSE listener missing');
else pass('catch-all SSE listener present');

if (!realtime.includes('admin_catalog_changed') && !realtime.includes('free_premium_changed')) {
  fail('realtime catalog probe candidates missing');
} else pass('realtime catalog probe candidates registered');

if (!theme.includes("accent: '#E60000'") && !theme.includes('accent: "#E60000"')) {
  fail('payment theme red accent');
} else pass('payment theme red accent #E60000');

if (!modal.includes('LIPIA SASA') || !modal.includes('PaymentBrandMark')) {
  fail('package-step redesign markers missing');
} else pass('package-step redesign markers');

if (!modal.includes('networkNameOnCard') || !modal.includes('Weka Namba ya Simu')) {
  fail('phone/operator redesign markers missing');
} else pass('phone/operator redesign markers');

if (!waiting.includes('Jinsi ya kuthibitisha malipo') || !waiting.includes('Inasubiri PIN')) {
  fail('PIN waiting redesign markers missing');
} else pass('PIN waiting redesign markers');

if (!media.includes('optimizeDisplayImageUrl') || !media.includes('b-cdn.net')) {
  fail('Bunny CDN display optimizer must remain');
} else pass('Bunny CDN display optimizer preserved');

if (!media.includes("DEFAULT_MEDIA_CDN_BASE = 'https://osmanitv.b-cdn.net'")) {
  fail('default Bunny CDN base missing');
} else pass('default Bunny CDN base intact');

console.log('\n[verify-admin-app-freshness] ok');
