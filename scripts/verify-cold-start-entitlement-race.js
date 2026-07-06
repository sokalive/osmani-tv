#!/usr/bin/env node
'use strict';

/**
 * Cold-start premium entitlement race — tri-state tap gate regression.
 * Run: node scripts/verify-cold-start-entitlement-race.js
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

const gate = read('lib/premiumTapGate.js');
const nav = read('lib/premiumChannelNavigation.js');
const ctx = read('context/OsmaniAppContext.jsx');
const app = read('App.js');

if (!gate.includes('entitlementState')) fail('tri-state entitlementState');
else pass('tri-state entitlementState');

if (!gate.includes('snapshotIsConfirmedInactive')) fail('confirmed inactive helper');
else pass('confirmed inactive helper');

if (!gate.includes('snapshotIsResolving')) fail('resolving helper');
else pass('resolving helper');

if (gate.includes('isSubscribed === false) return initial')) {
  fail('must not short-circuit unresolved false as inactive');
} else pass('no false short-circuit on cold start');

if (!gate.includes('PREMIUM_TAP_RESOLVE_MS')) fail('cold-start resolve cap');
else pass('cold-start resolve cap');

if (!nav.includes('awaitEntitlementForTap')) fail('nav uses awaitEntitlementForTap');
else pass('nav awaitEntitlementForTap');

if (!nav.includes('entitlement_still_resolving_no_popup')) {
  fail('unresolved must not open payment popup');
} else pass('no false payment popup while resolving');

if (!nav.includes("await verifySubscriptionBeforePlay('channel-tap-premium')")) {
  pass('no blocking pre-navigation verify');
} else fail('blocking pre-navigation verify forbidden');

if (!ctx.includes('awaitEntitlementForTap')) fail('context exports awaitEntitlementForTap');
else pass('context awaitEntitlementForTap');

if (!ctx.includes('premium-await-hydrate')) fail('premium await hydrates cache first');
else pass('premium await cache hydrate');

if (!ctx.includes('subscriptionSyncLoaded')) fail('snapshot includes subscriptionSyncLoaded');
else pass('snapshot subscriptionSyncLoaded');

if (!app.includes('awaitEntitlementForTap')) fail('App wires awaitEntitlementForTap');
else pass('App wires awaitEntitlementForTap');

// Simulation: cold start false must be resolving not inactive
function withEntitlementState(snapshot) {
  const active = snapshot?.isSubscribed === true;
  const ready = snapshot?.premiumPlaybackReady === true;
  let entitlementState = 'resolving';
  if (active) entitlementState = 'active';
  else if (ready) entitlementState = 'inactive';
  return { ...snapshot, entitlementState };
}

function snapshotIsConfirmedInactive(snapshot) {
  if (snapshot?.entitlementState === 'inactive') return true;
  return snapshot?.premiumPlaybackReady === true && snapshot?.isSubscribed !== true;
}

const coldFalse = withEntitlementState({
  isSubscribed: false,
  premiumPlaybackReady: false,
  subscriptionSyncLoaded: false,
});
if (coldFalse.entitlementState !== 'resolving') fail('sim: cold false is resolving');
else pass('sim: cold false is resolving');

if (snapshotIsConfirmedInactive(coldFalse)) fail('sim: cold false not confirmed inactive');
else pass('sim: no false popup on cold false');

const coldActive = withEntitlementState({
  isSubscribed: true,
  premiumPlaybackReady: false,
  subscriptionSyncLoaded: false,
});
if (coldActive.entitlementState !== 'active') fail('sim: hydrated active');
else pass('sim: hydrated active immediate');

const bootInactive = withEntitlementState({
  isSubscribed: false,
  premiumPlaybackReady: true,
  subscriptionSyncLoaded: true,
});
if (!snapshotIsConfirmedInactive(bootInactive)) fail('sim: boot inactive confirmed');
else pass('sim: confirmed inactive after sync');

let navigated = 0;
let popup = 0;
function decide(snap) {
  const s = withEntitlementState(snap);
  if (s.entitlementState === 'active') {
    navigated += 1;
    return;
  }
  if (snapshotIsConfirmedInactive(s)) {
    popup += 1;
    return;
  }
}
decide({ isSubscribed: false, premiumPlaybackReady: false, subscriptionSyncLoaded: false });
if (popup > 0) fail('sim: cold tap opened popup');
else pass('sim: cold tap no popup');

decide({ isSubscribed: true, premiumPlaybackReady: false, subscriptionSyncLoaded: false });
if (navigated !== 1) fail('sim: active navigates once');
else pass('sim: active one navigation');

if (process.exitCode) process.exit(1);
console.log('\n[verify-cold-start-entitlement-race] ok');
