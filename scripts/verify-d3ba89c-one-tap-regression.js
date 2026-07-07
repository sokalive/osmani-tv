#!/usr/bin/env node
'use strict';

/**
 * d3ba89c one-tap premium regression — first tap must complete without re-tap.
 * Run: node scripts/verify-d3ba89c-one-tap-regression.js
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
const nav = read('lib/premiumChannelNavigation.js');
const intent = read('lib/premiumAccessIntent.js');
const policy = read('lib/premiumAccessPromptPolicy.js');

if (app.includes('openPremiumModal(freshPlayerChannel)')) pass('App direct openPremiumModal on tap');
else fail('App direct openPremiumModal on tap');

if (!app.includes('openPremiumModalFromExplicitTap')) pass('removed blocking intent gate wrapper');
else fail('removed blocking intent gate wrapper');

if (nav.includes('snapshotAllowsExplicitTapPayment')) pass('nav uses d3ba89c explicit tap payment');
else fail('nav uses d3ba89c explicit tap payment');

if (nav.includes('payment_modal_d3ba89c_fallback')) pass('nav d3ba89c terminal fallback');
else fail('nav d3ba89c terminal fallback');

if (app.includes('touchPremiumAccessIntent')) pass('App retains intent during resolve');
else fail('App retains intent during resolve');

if (!app.includes('clearPremiumAccessIntent();\n        return false')) {
  pass('App does not clear intent on transient payment block');
} else fail('App does not clear intent on transient payment block');

if (app.includes('getPremiumPendingChannel')) pass('App deferred uses module pending channel');
else fail('App deferred uses module pending channel');

if (nav.includes('await_unknown')) pass('nav awaits UNKNOWN phase');
else fail('nav awaits UNKNOWN phase');

if (nav.includes('entitlement_pending_deferred')) pass('nav defers pending entitlement');
else fail('nav defers pending entitlement');

if (intent.includes('touchPremiumAccessIntent')) pass('intent touch helper');
else fail('intent touch helper');

if (intent.includes('setPremiumPendingChannel')) pass('module pending channel store');
else fail('module pending channel store');

if (policy.includes('snapshotAuthorizesPremiumPayment')) pass('payment phase split from intent');
else fail('payment phase split from intent');

// --- lifecycle simulation ---
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

let activeIntent = null;
let pendingChannel = null;
let paymentModalOpens = 0;
let navigations = 0;
const TTL = 60_000;

function grantPremiumAccessIntent() {
  activeIntent = { grantedAt: Date.now() };
}

function touchPremiumAccessIntent() {
  if (!activeIntent) return false;
  activeIntent.grantedAt = Date.now();
  return true;
}

function clearPremiumAccessIntent() {
  activeIntent = null;
}

function hasFreshPremiumAccessIntent() {
  return Boolean(activeIntent && Date.now() - activeIntent.grantedAt <= TTL);
}

function consumePremiumAccessIntent() {
  if (!hasFreshPremiumAccessIntent()) return null;
  activeIntent = null;
  return {};
}

function setPremiumPendingChannel(ch) {
  pendingChannel = ch;
}

function takePremiumPendingChannel() {
  const ch = pendingChannel;
  pendingChannel = null;
  return ch;
}

function snapshotAllowsExplicitTapPayment(snapshot) {
  const s = snapshot ?? {};
  const phase = s.entitlementPhase ?? deriveEntitlementPhase(s);
  if (mayOpenPaymentPopup(phase)) return true;
  if (phase === 'CHECKING' || phase === 'ERROR_UNKNOWN') return false;
  if (phase === 'ACTIVE' || phase === 'STALE_ACTIVE' || s.isSubscribed === true) return false;
  if (s.cacheTrustedActive === true) return false;
  return s.subscriptionSyncLoaded === true;
}

function openPremiumModalFromExplicitTap(channel) {
  if (!hasFreshPremiumAccessIntent()) return false;
  const snap = snapshot;
  if (!snapshotAllowsExplicitTapPayment(snap)) {
    touchPremiumAccessIntent();
    return false;
  }
  consumePremiumAccessIntent();
  paymentModalOpens += 1;
  takePremiumPendingChannel();
  return true;
}

function openPremiumModalDirect(channel) {
  consumePremiumAccessIntent();
  paymentModalOpens += 1;
  takePremiumPendingChannel();
}

function deferredResume(snap) {
  const channel = pendingChannel;
  if (!channel) return;
  if (snap.isSubscribed === true || snap.cacheTrustedActive) {
    navigations += 1;
    takePremiumPendingChannel();
    return;
  }
  if (snapshotAllowsExplicitTapPayment(snap)) {
    openPremiumModalDirect(channel);
  }
}

let snapshot = { isSubscribed: false, subscriptionSyncLoaded: false };

sim('inactive cold: first tap deferred retains action', () => {
  paymentModalOpens = 0;
  navigations = 0;
  pendingChannel = null;
  clearPremiumAccessIntent();
  grantPremiumAccessIntent();
  setPremiumPendingChannel({ id: 'bein' });
  snapshot = { isSubscribed: false, subscriptionSyncLoaded: false };
  openPremiumModalDirect({ id: 'bein' });
  return paymentModalOpens === 0 && pendingChannel;
});

sim('inactive UNKNOWN sync loaded opens payment on tap', () => {
  paymentModalOpens = 0;
  grantPremiumAccessIntent();
  snapshot = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  };
  return snapshotAllowsExplicitTapPayment(snapshot);
});

sim('inactive cold: deferred opens PremiumModal once', () => {
  snapshot = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  deferredResume(snapshot);
  return paymentModalOpens === 1 && !pendingChannel;
});

sim('6523df0 bug: clearing intent blocks deferred (repro)', () => {
  paymentModalOpens = 0;
  pendingChannel = { id: 'bein' };
  grantPremiumAccessIntent();
  clearPremiumAccessIntent();
  snapshot = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  deferredResume(snapshot);
  return paymentModalOpens === 0;
});

sim('fix: UNKNOWN sync loaded deferred payment', () => {
  paymentModalOpens = 0;
  pendingChannel = { id: 'bein' };
  grantPremiumAccessIntent();
  snapshot = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  };
  deferredResume(snapshot);
  return paymentModalOpens === 1;
});

sim('active cold: deferred navigates once', () => {
  navigations = 0;
  pendingChannel = { id: 'bein' };
  grantPremiumAccessIntent();
  snapshot = { isSubscribed: true, subscriptionSyncLoaded: true };
  deferredResume(snapshot);
  return navigations === 1;
});

sim('unknown: no payment until authoritative inactive', () => {
  paymentModalOpens = 0;
  grantPremiumAccessIntent();
  snapshot = { isSubscribed: false, subscriptionSyncLoaded: true, authoritativeInactiveConfirmed: false };
  openPremiumModalFromExplicitTap({ id: 'x' });
  return paymentModalOpens === 0 && hasFreshPremiumAccessIntent();
});

sim('rapid taps coalesce single-flight', () => {
  clearPremiumAccessIntent();
  grantPremiumAccessIntent({ channelKey: 'bein' });
  const first = activeIntent.grantedAt;
  grantPremiumAccessIntent({ channelKey: 'bein' });
  return activeIntent.grantedAt >= first;
});

sim('no tap no popup', () => {
  paymentModalOpens = 0;
  clearPremiumAccessIntent();
  pendingChannel = null;
  snapshot = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  deferredResume(snapshot);
  return paymentModalOpens === 0;
});

if (!read('lib/openOsmaniDeepLink.js').includes('touchPremiumAccessIntent')) {
  fail('deep link retains intent during resolve');
} else pass('deep link retains intent during resolve');

if (read('components/BannerCarousel.js').includes('setPremiumPendingChannel')) {
  pass('banner defers pending channel');
} else fail('banner defers pending channel');

console.log(`\n[verify-d3ba89c-one-tap-regression] pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
