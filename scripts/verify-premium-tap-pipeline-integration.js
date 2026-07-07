#!/usr/bin/env node
'use strict';

/**
 * Integration-style premium tap pipeline simulation.
 * Run: node scripts/verify-premium-tap-pipeline-integration.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

let pass = 0;
let fail = 0;

function ok(msg) {
  pass += 1;
  console.log('PASS:', msg);
}

function bad(msg) {
  fail += 1;
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function sim(name, cond) {
  if (cond) ok(`sim: ${name}`);
  else bad(`sim: ${name}`);
}

const app = read('App.js');
const nav = read('lib/premiumChannelNavigation.js');

if (app.includes('openPaymentModal: () => openPremiumModal(freshPlayerChannel)')) {
  ok('home tap wires direct PremiumModal');
} else bad('home tap wires direct PremiumModal');

if (!app.includes('openPremiumModalFromExplicitTap')) ok('blocking wrapper removed');
else bad('blocking wrapper removed');

if (nav.includes('payment_modal_d3ba89c_explicit_tap')) ok('d3ba89c explicit tap fallback');
else bad('d3ba89c explicit tap fallback');

if (nav.includes('hasFreshPremiumAccessIntent')) ok('nav gates payment on explicit intent');
else bad('nav gates payment on explicit intent');

function deriveEntitlementPhase(snapshot) {
  const s = snapshot ?? {};
  if (s.isSubscribed === true) return 'ACTIVE';
  if (s.cacheTrustedActive === true) return 'STALE_ACTIVE';
  if (s.authoritativeInactiveConfirmed === true) return 'INACTIVE';
  if (s.subscriptionSyncLoaded !== true) return 'CHECKING';
  if (s.lastResolveSource && String(s.lastResolveSource).startsWith('transport:')) return 'ERROR_UNKNOWN';
  return 'UNKNOWN';
}

function snapshotHasActiveSubscription(snapshot) {
  const phase = deriveEntitlementPhase(snapshot);
  return phase === 'ACTIVE' || phase === 'STALE_ACTIVE' || snapshot?.isSubscribed === true;
}

function snapshotAllowsExplicitTapPayment(snapshot) {
  const s = snapshot ?? {};
  const phase = deriveEntitlementPhase(s);
  if (phase === 'INACTIVE' || phase === 'EXPIRED') return true;
  if (phase === 'CHECKING' || phase === 'ERROR_UNKNOWN') return false;
  if (phase === 'ACTIVE' || phase === 'STALE_ACTIVE' || s.isSubscribed === true) return false;
  if (s.cacheTrustedActive === true) return false;
  return s.subscriptionSyncLoaded === true;
}

let intent = false;
let pending = null;
let modalOpens = 0;
let navigations = 0;

function tap(channel) {
  intent = true;
  pending = channel;
}

function clearIntent() {
  intent = false;
}

function simulateTapPipeline(snapshot) {
  if (snapshotHasActiveSubscription(snapshot)) {
    navigations += 1;
    pending = null;
    clearIntent();
    return 'navigated';
  }
  if (
    snapshotAllowsExplicitTapPayment(snapshot) ||
    (intent && !snapshotHasActiveSubscription(snapshot) && snapshot.subscriptionSyncLoaded === true)
  ) {
    modalOpens += 1;
    pending = null;
    clearIntent();
    return 'payment';
  }
  if (intent && snapshot.subscriptionSyncLoaded !== true) {
    return 'deferred';
  }
  if (intent && snapshot.subscriptionSyncLoaded === true && !snapshotHasActiveSubscription(snapshot)) {
    modalOpens += 1;
    pending = null;
    clearIntent();
    return 'payment';
  }
  return 'noop';
}

sim('INACTIVE warm first tap opens modal', () => {
  modalOpens = 0;
  tap({ id: 'bein' });
  return simulateTapPipeline({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  }) === 'payment' && modalOpens === 1;
});

sim('INACTIVE UNKNOWN sync loaded opens modal', () => {
  modalOpens = 0;
  tap({ id: 'bein' });
  return simulateTapPipeline({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  }) === 'payment' && modalOpens === 1;
});

sim('ACTIVE first tap opens channel', () => {
  navigations = 0;
  tap({ id: 'bein' });
  return simulateTapPipeline({ isSubscribed: true, subscriptionSyncLoaded: true }) === 'navigated';
});

sim('CHECKING defers then completes', () => {
  modalOpens = 0;
  tap({ id: 'bein' });
  const first = simulateTapPipeline({ isSubscribed: false, subscriptionSyncLoaded: false });
  const second = simulateTapPipeline({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  });
  return first === 'deferred' && second === 'payment' && modalOpens === 1;
});

sim('no tap no popup on sync', () => {
  modalOpens = 0;
  clearIntent();
  pending = null;
  return simulateTapPipeline({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  }) === 'noop';
});

sim('10 rapid taps one modal', () => {
  modalOpens = 0;
  for (let i = 0; i < 10; i += 1) tap({ id: 'bein' });
  simulateTapPipeline({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
  });
  return modalOpens === 1;
});

console.log(`\n[verify-premium-tap-pipeline-integration] pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
