/**
 * Sanity checks for Phase 1 cost-optimization constants and modules.
 * Run: node scripts/verify-cost-optimization.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ctx = read('context/OsmaniAppContext.jsx');
assert(ctx.includes('SETTINGS_POLL_MS = 10000'), 'settings poll should be 10s');
assert(ctx.includes('LIVE_SYNC_BASE_MS = 30000'), 'catalog sync should be 30s');
assert(ctx.includes('invalidateCatalogCache'), 'context should invalidate cache on force refresh');
assert(ctx.includes("AppState.currentState !== 'active'"), 'settings poll should skip background');

const api = read('api.js');
assert(api.includes('getCachedChannels'), 'channels should use in-memory cache');
assert(api.includes('getCachedBanners'), 'banners should use in-memory cache');

const expo = read('lib/expoUpdatesClient.js');
assert(expo.includes('FOREGROUND_RECHECK_MS = 8'), 'OTA foreground throttle should be 8h');
assert(expo.includes('LONG_INTERVAL_RECHECK_MS = 12'), 'OTA long-interval backup should exist');

const media = read('lib/mediaDelivery.js');
assert(media.includes('optimizeDisplayImageUrl'), 'display image optimizer required');

const analytics = read('api/analytics.js');
assert(analytics.includes('PRESENCE_PING_MS = 45000'), 'presence ping should be 45s');

console.log('[verify-cost-optimization] ok');
