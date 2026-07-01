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
if (!ctx.includes("reverifySubscription('boot-recovery')")) {
  fail('cold start must await boot-recovery verify before sync loaded');
} else pass('boot-recovery verify before sync loaded');
if (!ctx.includes('skipped_stale_active_snapshot')) fail('stale hydrate skip log');
else pass('stale hydrate skip wired');

const api = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
if (!api.includes('getSubscriptionStatusForDevice')) fail('exported subscription-status helper');
else pass('subscription-status export');

if (!process.exitCode) {
  console.log('\n[verify-subscription-cache-repair] ok');
}
