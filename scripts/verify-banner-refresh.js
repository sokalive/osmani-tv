#!/usr/bin/env node
'use strict';

/**
 * Banner catalog refresh guards — stale disk hydrate must not clobber network sync.
 * Run: node scripts/verify-banner-refresh.js
 */

const fs = require('fs');
const path = require('path');
const { ADMIN_SOFT_REFRESH_SSE_EVENTS } = require('../lib/adminSseRefreshEvents');

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

const ctx = read('context/OsmaniAppContext.jsx');
const events = read('lib/adminSseRefreshEvents.js');

if (!ctx.includes('catalogNetworkHydratedRef')) {
  fail('context must guard disk hydrate with catalogNetworkHydratedRef');
} else pass('catalog network hydrate guard ref');

if (!ctx.includes('catalogNetworkHydratedRef.current.banners')) {
  fail('context must skip banner disk hydrate after network sync');
} else pass('banner disk hydrate skipped after network');

if (!ctx.includes('startup-banners-retry')) {
  fail('context must retry banners fetch on forceNetwork timeout');
} else pass('forceNetwork banners retry');

for (const ev of [
  'banners_changed',
  'banners_updated',
  'banner_updated',
  'banner_changed',
  'catalog_refresh',
]) {
  if (!ADMIN_SOFT_REFRESH_SSE_EVENTS.includes(ev)) fail(`missing banner SSE alias: ${ev}`);
  else pass(`banner SSE alias registered: ${ev}`);
}

if (!events.includes('banner_created') || !events.includes('banner_deleted')) {
  fail('banner create/delete SSE aliases missing');
} else pass('banner create/delete SSE aliases');

console.log('\n[verify-banner-refresh] done');
