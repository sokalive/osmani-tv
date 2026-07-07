#!/usr/bin/env node
'use strict';

/**
 * Slow-bootstrap payment affordance — KULIPIA + explicit tap must not wait for INAPAKIA.
 * Run: node scripts/verify-slow-bootstrap-payment-affordance.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

let passCount = 0;
let failCount = 0;

function pass(msg) {
  passCount += 1;
  console.log('PASS:', msg);
}

function fail(msg) {
  failCount += 1;
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function sim(name, cond) {
  if (cond) pass(`sim: ${name}`);
  else fail(`sim: ${name}`);
}

const app = read('App.js');
const ctx = read('context/OsmaniAppContext.jsx');
const gate = read('lib/premiumTapGate.js');
const policy = read('lib/paymentAffordancePolicy.js');
const nav = read('lib/premiumChannelNavigation.js');

if (policy.includes('mayShowPaymentAffordance')) pass('payment affordance policy module');
else fail('payment affordance policy module');

if (policy.includes('mayOpenPaymentOnExplicitTap')) pass('explicit tap payment policy');
else fail('explicit tap payment policy');

if (policy.includes('hasTrustedActiveEntitlement')) pass('trusted active helper');
else fail('trusted active helper');

if (gate.includes('resolveExplicitPremiumTapSnapshot')) pass('resolveExplicitPremiumTapSnapshot');
else fail('resolveExplicitPremiumTapSnapshot');

if (!app.includes('awaitPremiumSnapshotCapped(getPremiumAccessSnapshot')) pass('App uses fast explicit tap snapshot');
else fail('App must not block taps on awaitPremiumSnapshotCapped');

if (!app.includes('if (!catalogAccessReady) return null')) pass('KULIPIA not gated on catalogAccessReady');
else fail('KULIPIA must not wait on catalogAccessReady');

if (ctx.includes('setCatalogAccessReady(true)') && ctx.includes('cachedChannels?.channels?.length')) {
  pass('catalogAccessReady on cache hydrate');
} else fail('catalogAccessReady on cache hydrate');

if (nav.includes('payment_modal_explicit_tap_no_bootstrap')) pass('nav bootstrap-free explicit tap');
else fail('nav bootstrap-free explicit tap');

if (nav.includes('mayOpenPaymentOnExplicitTap')) pass('nav uses explicit tap policy');
else fail('nav uses explicit tap policy');

const {
  mayShowPaymentAffordance,
  mayOpenPaymentOnExplicitTap,
  hasTrustedActiveEntitlement,
} = (() => {
  function deriveEntitlementPhase(snapshot) {
    const s = snapshot ?? {};
    if (s.isSubscribed === true) return 'ACTIVE';
    if (s.cacheTrustedActive === true) return 'STALE_ACTIVE';
    if (s.authoritativeInactiveConfirmed === true) return 'INACTIVE';
    if (s.subscriptionSyncLoaded !== true) return 'CHECKING';
    return 'UNKNOWN';
  }
  function snapshotHasActiveSubscription(snapshot) {
    const phase = deriveEntitlementPhase(snapshot);
    return phase === 'ACTIVE' || phase === 'STALE_ACTIVE' || snapshot?.isSubscribed === true;
  }
  function hasTrustedActiveEntitlement(snapshot) {
    return snapshotHasActiveSubscription(snapshot);
  }
  function mayShowPaymentAffordance(input) {
    if (!input?.isPremium || input?.freeMode) return false;
    if (input?.isSubscribed === true || input?.cacheTrustedActive === true) return false;
    return true;
  }
  function mayOpenPaymentOnExplicitTap(snapshot) {
    const s = snapshot ?? {};
    if (hasTrustedActiveEntitlement(s)) return false;
    const phase = deriveEntitlementPhase(s);
    if (phase === 'INACTIVE' || phase === 'EXPIRED') return true;
    if (phase === 'ACTIVE' || phase === 'STALE_ACTIVE' || s.cacheTrustedActive === true) return false;
    return true;
  }
  return { mayShowPaymentAffordance, mayOpenPaymentOnExplicitTap, hasTrustedActiveEntitlement };
})();

sim('KULIPIA during CHECKING unpaid', () => {
  return mayShowPaymentAffordance({ isPremium: true, freeMode: false, isSubscribed: false }) === true;
});

sim('no KULIPIA when subscribed', () => {
  return mayShowPaymentAffordance({ isPremium: true, freeMode: false, isSubscribed: true }) === false;
});

sim('no KULIPIA when cache trusted active', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      freeMode: false,
      isSubscribed: false,
      cacheTrustedActive: true,
    }) === false
  );
});

sim('explicit tap payment during CHECKING unpaid', () => {
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: false,
    cacheTrustedActive: false,
    authoritativeInactiveConfirmed: false,
  };
  return mayOpenPaymentOnExplicitTap(snap) === true;
});

sim('no payment tap when trusted active', () => {
  const snap = { isSubscribed: true, subscriptionSyncLoaded: true, cacheTrustedActive: false };
  return mayOpenPaymentOnExplicitTap(snap) === false && hasTrustedActiveEntitlement(snap) === true;
});

sim('no payment tap when cache trusted', () => {
  const snap = {
    isSubscribed: true,
    subscriptionSyncLoaded: false,
    cacheTrustedActive: true,
    authoritativeInactiveConfirmed: false,
  };
  return mayOpenPaymentOnExplicitTap(snap) === false;
});

sim('authoritative inactive opens payment', () => {
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  return mayOpenPaymentOnExplicitTap(snap) === true;
});

sim('sync loaded UNKNOWN unpaid opens payment', () => {
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  };
  return mayOpenPaymentOnExplicitTap(snap) === true;
});

console.log(`\n[verify-slow-bootstrap-payment-affordance] pass=${passCount} fail=${failCount}`);
if (failCount) process.exit(1);
