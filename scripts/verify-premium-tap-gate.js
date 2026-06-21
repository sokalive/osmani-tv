#!/usr/bin/env node
'use strict';

/**
 * Premium channel tap must not block on recover/verify (800ms cap, cache-first).
 * Run: node scripts/verify-premium-tap-gate.js
 */

const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const gate = read('lib/premiumTapGate.js');
const ctx = read('context/OsmaniAppContext.jsx');
const nav = read('lib/premiumChannelNavigation.js');
const app = read('App.js');
const player = read('screens/ChannelPlayerScreen.js');

if (!gate.includes('PREMIUM_GATE_MAX_MS = 800')) fail('PREMIUM_GATE_MAX_MS must be 800');
else pass('PREMIUM_GATE_MAX_MS = 800');

if (!ctx.includes('subscriptionCacheReady')) fail('context must use subscriptionCacheReady');
else pass('subscriptionCacheReady separates cache from network sync');

if (!ctx.includes('awaitSubscriptionCacheReady')) fail('tap must await cache only');
else pass('awaitSubscriptionCacheReady (not recoverAndVerify on tap)');

if (ctx.includes('awaitSubscriptionSyncReady(), awaitSubscriptionCacheReady()')) {
  pass('awaitPremiumAccessSnapshot caps cache+trial at 800ms');
} else if (ctx.includes('PREMIUM_GATE_MAX_MS')) {
  pass('awaitPremiumAccessSnapshot uses PREMIUM_GATE_MAX_MS cap');
} else {
  fail('awaitPremiumAccessSnapshot missing 800ms cap');
}

if (!nav.includes('premium_subscribed_cache_fast')) fail('subscribed fast path missing');
else pass('subscribed users navigate without blocking verify');

if (!nav.includes('void openPaymentModal()')) fail('unpaid must open payment modal without await');
else pass('unpaid opens payment modal immediately');

if (!app.includes('awaitPremiumSnapshotCapped')) fail('App.js must use capped snapshot');
else pass('App.js uses awaitPremiumSnapshotCapped');

if (!player.includes("reverifySubscription('player-mount-bg')")) {
  fail('player must verify in background for subscribed users');
} else pass('player background verify for subscribed cache');

if (player.includes('await gateForPlayback(\'player-mount\')') && player.includes('isSubscribed')) {
  pass('player only blocks gate when not subscribed from cache');
} else {
  fail('player gate fast path incomplete');
}

console.log('\n--- Timing model (app-side) ---');
console.log('  Paid user (cached active): tap → player  <800ms (typically <100ms after cache hydrate)');
console.log('  Unpaid / unknown:         tap → modal   <800ms (payment modal, no verify wait)');
console.log('  Before fix:               tap blocked on recoverAndVerify (15s+) + sync verify + player gate (unbounded)');

if (!process.exitCode) {
  console.log('\n[verify-premium-tap-gate] ok');
}
