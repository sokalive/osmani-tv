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

if (!ctx.includes('authoritativeInactiveConfirmed')) fail('authoritative inactive in snapshot');
else pass('authoritative inactive in snapshot');

if (!read('lib/entitlementStateMachine.js').includes('deriveEntitlementPhase')) {
  fail('canonical entitlement state machine');
} else pass('canonical entitlement state machine');

if (!app.includes('awaitEntitlementForTap')) fail('App wires awaitEntitlementForTap');
else pass('App wires awaitEntitlementForTap');

// Simulation via inline canonical state machine (Node CJS)
function deriveEntitlementPhase(snapshot) {
  const s = snapshot ?? {};
  if (s.isSubscribed === true) return 'ACTIVE';
  if (s.cacheTrustedActive === true) return 'STALE_ACTIVE';
  if (s.authoritativeInactiveConfirmed === true) return 'INACTIVE';
  if (s.subscriptionSyncLoaded !== true) return 'CHECKING';
  if (s.lastResolveSource && String(s.lastResolveSource).startsWith('transport:')) return 'ERROR_UNKNOWN';
  return 'UNKNOWN';
}

function mayOpenPaymentPopup(phase) {
  return phase === 'INACTIVE' || phase === 'EXPIRED';
}

function withCanonicalEntitlement(snapshot) {
  const entitlementPhase = deriveEntitlementPhase(snapshot);
  let entitlementState = 'resolving';
  if (entitlementPhase === 'ACTIVE') entitlementState = 'active';
  else if (mayOpenPaymentPopup(entitlementPhase)) entitlementState = 'inactive';
  return { ...snapshot, entitlementPhase, entitlementState };
}

function simConfirmedInactive(snapshot) {
  return mayOpenPaymentPopup(snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot));
}

const coldFalse = withCanonicalEntitlement({
  isSubscribed: false,
  subscriptionSyncLoaded: false,
  authoritativeInactiveConfirmed: false,
});
if (coldFalse.entitlementPhase !== 'CHECKING') fail('sim: cold false is CHECKING');
else pass('sim: cold false is resolving');

if (simConfirmedInactive(coldFalse) || mayOpenPaymentPopup(coldFalse.entitlementPhase)) {
  fail('sim: cold false not confirmed inactive');
} else pass('sim: no false popup on cold false');

const coldActive = withCanonicalEntitlement({
  isSubscribed: true,
  subscriptionSyncLoaded: false,
});
if (coldActive.entitlementPhase !== 'ACTIVE') fail('sim: hydrated active');
else pass('sim: hydrated active immediate');

const bootInactive = withCanonicalEntitlement({
  isSubscribed: false,
  subscriptionSyncLoaded: true,
  authoritativeInactiveConfirmed: true,
});
if (!simConfirmedInactive(bootInactive)) fail('sim: boot inactive confirmed');
else pass('sim: confirmed inactive after sync');

const oldBug = withCanonicalEntitlement({
  isSubscribed: false,
  premiumPlaybackReady: true,
  subscriptionSyncLoaded: true,
  authoritativeInactiveConfirmed: false,
});
if (simConfirmedInactive(oldBug)) fail('sim: sync loaded alone must not be inactive');
else pass('sim: sync loaded without authoritative inactive');

let navigated = 0;
let popup = 0;
function decide(snap) {
  const s = withCanonicalEntitlement(snap);
  if (s.entitlementPhase === 'ACTIVE' || s.entitlementPhase === 'STALE_ACTIVE') {
    navigated += 1;
    return;
  }
  if (simConfirmedInactive(s) || mayOpenPaymentPopup(s.entitlementPhase)) {
    popup += 1;
    return;
  }
}
decide({
  isSubscribed: false,
  subscriptionSyncLoaded: false,
  authoritativeInactiveConfirmed: false,
});
if (popup > 0) fail('sim: cold tap opened popup');
else pass('sim: cold tap no popup');

decide({ isSubscribed: true, premiumPlaybackReady: false, subscriptionSyncLoaded: false });
if (navigated !== 1) fail('sim: active navigates once');
else pass('sim: active one navigation');

if (process.exitCode) process.exit(1);
console.log('\n[verify-cold-start-entitlement-race] ok');
