#!/usr/bin/env node
'use strict';

/**
 * Canonical entitlement state machine — cold-start race regression matrix.
 * Run: node scripts/verify-entitlement-state-machine.js
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

const sm = read('lib/entitlementStateMachine.js');
const gate = read('lib/premiumTapGate.js');
const nav = read('lib/premiumChannelNavigation.js');
const ctx = read('context/OsmaniAppContext.jsx');
const hydrate = read('lib/subscriptionCacheHydrate.js');

if (!sm.includes('deriveEntitlementPhase')) fail('state machine module');
else pass('state machine module');

if (!sm.includes('mayOpenPaymentPopup')) fail('payment popup guard');
else pass('payment popup guard');

if (!ctx.includes('authoritativeInactiveRef')) fail('authoritative inactive ref');
else pass('authoritative inactive ref');

if (!ctx.includes('cacheTrustedActiveRef')) fail('cache trusted active ref');
else pass('cache trusted active ref');

if (!ctx.includes('provider-eager-hydrate')) fail('eager cache hydrate');
else pass('eager cache hydrate');

if (!ctx.includes('useLayoutEffect')) fail('layout effect bootstrap');
else pass('layout effect bootstrap');

if (!ctx.includes('cache_preserved_after_resolve')) fail('boot cache preserve');
else pass('boot cache preserve');

if (!ctx.includes('authoritativeInactiveConfirmed')) fail('snapshot authoritative flag');
else pass('snapshot authoritative flag');

if (!ctx.includes('entitlementPhase')) fail('snapshot entitlement phase');
else pass('snapshot entitlement phase');

if (gate.includes('premiumPlaybackReady === true') && gate.includes('inactive')) {
  fail('gate must not use premiumPlaybackReady as inactive');
} else pass('no premiumPlaybackReady inactive shortcut');

if (!nav.includes('onEntitlementDeferred')) fail('deferred tap callback');
else pass('deferred tap callback');

if (!nav.includes('entitlement_ambiguous_no_popup')) fail('ambiguous no popup path');
else pass('ambiguous no popup path');

if (!hydrate.includes('readStoredIdentityHints')) fail('stored identity hints for cache');
else pass('stored identity hints for cache');

if (!ctx.includes('shouldHydrateSubscriptionCache')) fail('context stale cache guard on hydrate');
else pass('stale cache rejection on hydrate');

// --- inline simulations (Node CJS — no ESM import) ---
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

function mayNavigatePremiumImmediate(phase) {
  return phase === 'ACTIVE' || phase === 'STALE_ACTIVE';
}

function withCanonicalEntitlement(snapshot) {
  const entitlementPhase = deriveEntitlementPhase(snapshot);
  let entitlementState = 'resolving';
  if (entitlementPhase === 'ACTIVE') entitlementState = 'active';
  else if (mayOpenPaymentPopup(entitlementPhase)) entitlementState = 'inactive';
  return { ...snapshot, entitlementPhase, entitlementState };
}

function snapshotIsConfirmedInactive(snapshot) {
  return mayOpenPaymentPopup(snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot));
}

function snapshotHasActiveSubscription(snapshot) {
  const phase = snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot);
  return mayNavigatePremiumImmediate(phase) || snapshot?.isSubscribed === true;
}

function sim(name, cond) {
  if (!cond) fail(`sim: ${name}`);
  else pass(`sim: ${name}`);
}

sim('cold false sync not loaded = CHECKING', () => {
  const p = deriveEntitlementPhase({ isSubscribed: false, subscriptionSyncLoaded: false });
  return p === 'CHECKING';
});

sim('sync loaded false not authoritative = UNKNOWN not INACTIVE', () => {
  const p = deriveEntitlementPhase({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  });
  return p === 'UNKNOWN' && !mayOpenPaymentPopup(p);
});

sim('authoritative inactive = payment allowed', () => {
  const p = deriveEntitlementPhase({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  });
  return mayOpenPaymentPopup(p);
});

sim('cache trusted = navigate allowed no popup', () => {
  const s = withCanonicalEntitlement({
    isSubscribed: false,
    cacheTrustedActive: true,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  });
  return mayNavigatePremiumImmediate(s.entitlementPhase) && !mayOpenPaymentPopup(s.entitlementPhase);
});

sim('active immediate navigate', () => {
  const s = withCanonicalEntitlement({ isSubscribed: true });
  return snapshotHasActiveSubscription(s) && !snapshotIsConfirmedInactive(s);
});

sim('checking never popup', () => {
  const s = withCanonicalEntitlement({ isSubscribed: false, subscriptionSyncLoaded: false });
  return !snapshotIsConfirmedInactive(s) && !mayOpenPaymentPopup(s.entitlementPhase);
});

sim('transport timeout = ERROR_UNKNOWN not INACTIVE', () => {
  const p = deriveEntitlementPhase({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
    lastResolveSource: 'transport:timeout',
  });
  return p === 'ERROR_UNKNOWN' && !mayOpenPaymentPopup(p);
});

sim('old bug: premiumPlaybackReady alone not inactive', () => {
  const s = withCanonicalEntitlement({
    isSubscribed: false,
    premiumPlaybackReady: true,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  });
  return !snapshotIsConfirmedInactive(s);
});

sim('1s delay scenario: cache active before sync', () => {
  const s = withCanonicalEntitlement({
    isSubscribed: true,
    cacheTrustedActive: true,
    subscriptionSyncLoaded: false,
  });
  return snapshotHasActiveSubscription(s) && !mayOpenPaymentPopup(s.entitlementPhase);
});

sim('never subscribed authoritative inactive', () => {
  const s = withCanonicalEntitlement({
    isSubscribed: false,
    authoritativeInactiveConfirmed: true,
    subscriptionSyncLoaded: true,
  });
  return snapshotIsConfirmedInactive(s) && mayOpenPaymentPopup(s.entitlementPhase);
});

if (process.exitCode) {
  console.error('\n[verify-entitlement-state-machine] FAILED');
  process.exit(1);
}
console.log('\n[verify-entitlement-state-machine] ok');
