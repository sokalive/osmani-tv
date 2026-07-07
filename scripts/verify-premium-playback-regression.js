#!/usr/bin/env node
'use strict';

/**
 * Premium tap regression — cache-first tap with capped gates (cd120e0 tap pipeline).
 * Run: node scripts/verify-premium-playback-regression.js
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
const banner = read('components/BannerCarousel.js');
const nav = read('lib/premiumChannelNavigation.js');
const gate = read('lib/premiumTapGate.js');

if (!gate.includes('resolveExplicitPremiumTapSnapshot')) fail('premiumTapGate explicit tap resolver');
else pass('premiumTapGate explicit tap resolver');

if (!app.includes('resolveExplicitPremiumTapSnapshot')) fail('App.js uses explicit tap snapshot');
else pass('App.js explicit tap snapshot');

if (!banner.includes('resolveExplicitPremiumTapSnapshot')) {
  fail('BannerCarousel must use explicit tap snapshot');
} else pass('BannerCarousel explicit tap snapshot');

if (nav.includes('await openPaymentModal()')) {
  fail('payment modal must open synchronously for instant UI');
} else pass('payment modal opens synchronously');

if (!nav.includes('snapshotHasActiveSubscription')) {
  fail('subscribed cache-fast path required');
} else pass('subscribed cache-fast navigation');

if (nav.includes("await verifySubscriptionBeforePlay")) {
  fail('subscribed tap must not await blocking verify before navigation');
} else pass('no blocking pre-navigation verify');

if (!nav.includes('verifySubscriptionInBackground')) {
  fail('background verify after navigation required');
} else pass('background verify after navigation');

if (nav.includes('shouldBlockChannelForUpdate')) {
  fail('channel update gate must not intercept unsubscribed payment modal');
} else pass('payment modal not blocked by channel update gate');

if (!process.exitCode) console.log('\n[verify-premium-playback-regression] ok');
