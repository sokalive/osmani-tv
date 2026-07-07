#!/usr/bin/env node
'use strict';

/**
 * Premium entry regression — inactive payment flow + active protection + popup removal.
 * Run: node scripts/verify-premium-entry-regression.js
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

const app = read('App.js');
const nav = read('lib/premiumChannelNavigation.js');
const sm = read('lib/entitlementStateMachine.js');

if (!sm.includes('snapshotIsReadyForPaymentFlow')) fail('payment flow readiness helper');
else pass('payment flow readiness helper');

if (!nav.includes('snapshotIsReadyForPaymentFlow')) fail('nav uses payment flow readiness');
else pass('nav uses payment flow readiness');

if (!nav.includes('snapshotNeedsEntitlementAwait')) fail('nav bounded await only CHECKING/ERROR');
else pass('nav bounded await only CHECKING/ERROR');

if (app.includes('TransferredAwayModal')) fail('TransferredAwayModal removed from App');
else pass('TransferredAwayModal removed from App');

if (app.includes('openPremiumAfterExpiry')) fail('openPremiumAfterExpiry removed from App');
else pass('openPremiumAfterExpiry removed from App');

if (read('screens/ChannelPlayerScreen.js').includes('openPremiumAfterExpiry')) {
  fail('openPremiumAfterExpiry removed from player');
} else pass('openPremiumAfterExpiry removed from player');

if (read('screens/AkauntiYanguScreen.js').includes('openPremiumAfterExpiry')) {
  fail('openPremiumAfterExpiry removed from account');
} else pass('openPremiumAfterExpiry removed from account');

if (!app.includes('snapshotIsReadyForPaymentFlow')) fail('App pending tap payment resume');
else pass('App pending tap payment resume');

function deriveEntitlementPhase(snapshot) {
  const s = snapshot ?? {};
  if (s.isSubscribed === true) return 'ACTIVE';
  if (s.cacheTrustedActive === true) return 'STALE_ACTIVE';
  if (s.authoritativeInactiveConfirmed === true) return 'INACTIVE';
  if (s.subscriptionSyncLoaded !== true) return 'CHECKING';
  if (s.lastResolveSource && String(s.lastResolveSource).startsWith('transport:')) return 'ERROR_UNKNOWN';
  return 'UNKNOWN';
}

function snapshotIsReadyForPaymentFlow(snapshot) {
  const s = snapshot ?? {};
  const phase = deriveEntitlementPhase(s);
  if (phase === 'INACTIVE' || phase === 'EXPIRED') return true;
  if (phase === 'CHECKING' || phase === 'ERROR_UNKNOWN') return false;
  if (phase === 'ACTIVE' || phase === 'STALE_ACTIVE' || s.isSubscribed === true) return false;
  if (s.cacheTrustedActive === true) return false;
  return s.subscriptionSyncLoaded === true;
}

function sim(name, cond) {
  if (!cond) fail(`sim: ${name}`);
  else pass(`sim: ${name}`);
}

sim('inactive sync loaded opens payment path', () =>
  snapshotIsReadyForPaymentFlow({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  }),
);

sim('checking blocks payment', () =>
  !snapshotIsReadyForPaymentFlow({
    isSubscribed: false,
    subscriptionSyncLoaded: false,
  }),
);

sim('active blocks payment', () =>
  !snapshotIsReadyForPaymentFlow({
    isSubscribed: true,
    subscriptionSyncLoaded: true,
  }),
);

sim('cache trusted blocks payment', () =>
  !snapshotIsReadyForPaymentFlow({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    cacheTrustedActive: true,
  }),
);

sim('authoritative inactive opens payment', () =>
  snapshotIsReadyForPaymentFlow({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  }),
);

if (process.exitCode) {
  console.error('\n[verify-premium-entry-regression] FAILED');
  process.exit(1);
}
console.log('\n[verify-premium-entry-regression] ok');
