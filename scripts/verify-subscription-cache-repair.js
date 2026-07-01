#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  isStaleActiveSubscriptionCache,
  shouldHydrateSubscriptionCache,
  needsSubscriptionCacheRepair,
} = require('../lib/subscriptionCacheRepair');

const root = path.join(__dirname, '..');
const hydrate = fs.readFileSync(path.join(root, 'lib', 'subscriptionCacheHydrate.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

const now = Date.parse('2026-06-27T12:00:00.000Z');
const past = '2026-06-20T12:00:00.000Z';
const future = '2026-07-18T12:00:00.000Z';

const stale = { active: true, expiresAt: past, planSnapshot: { expiresAt: past } };
if (!isStaleActiveSubscriptionCache(stale, now)) fail('past expiry without remaining_seconds is stale');
else pass('detect stale active cache');

const fresh = {
  active: true,
  expiresAt: future,
  planSnapshot: { expiresAt: future, remaining_seconds: 86400 * 10 },
};
if (isStaleActiveSubscriptionCache(fresh, now)) fail('fresh remaining_seconds must not be stale');
else pass('fresh cache with remaining_seconds is not stale');

if (shouldHydrateSubscriptionCache(stale, now)) fail('must not hydrate stale cache');
else pass('skip hydrate for stale cache');

if (!needsSubscriptionCacheRepair({ active: false })) fail('inactive cache needs repair');
else pass('inactive cache flagged for repair');

if (!hydrate.includes('subscriptionDetailsFromVerifyResult')) {
  fail('hydrate must export subscriptionDetailsFromVerifyResult');
} else pass('subscriptionDetailsFromVerifyResult export');

const ctx = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
if (!ctx.includes('setSubscriptionSyncLoaded(true)')) {
  fail('cold start must mark sync loaded');
} else pass('sync loaded flag');

const syncLoadedIdx = ctx.indexOf('setSubscriptionSyncLoaded(true)');
const bgVerifyIdx = ctx.indexOf("reverifySubscription('cold-start-bg')");
if (syncLoadedIdx < 0 || bgVerifyIdx < 0 || syncLoadedIdx > bgVerifyIdx) {
  fail('sync loaded must be set before background cold-start-bg verify');
} else pass('sync ready before background verify');

if (ctx.includes('skipped_stale_active_snapshot')) fail('must not skip stale active hydrate');
else pass('hydrate stale active cache allowed');

const api = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
if (!api.includes('getSubscriptionStatusForDevice')) fail('exported subscription-status helper');
else pass('subscription-status export');

if (!process.exitCode) {
  console.log('\n[verify-subscription-cache-repair] ok');
}
