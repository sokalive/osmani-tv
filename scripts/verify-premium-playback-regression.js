#!/usr/bin/env node
'use strict';

/**
 * Premium tap regression — instant payment modal for unsubscribed; await snapshot for subscribed boot.
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
const tap = read('lib/premiumChannelTapSnapshot.js');

if (!tap.includes('paymentImmediate')) fail('premiumChannelTapSnapshot helper');
else pass('premiumChannelTapSnapshot helper');

if (!app.includes('resolveChannelTapAccessSnapshot')) fail('App.js uses tap snapshot helper');
else pass('App.js tap snapshot helper');

if (!app.includes('snapshot_payment_immediate')) fail('App.js logs payment-immediate path');
else pass('App.js payment-immediate logging');

if (!tap.includes('await awaitPremiumAccessSnapshot()')) {
  fail('App.js must await snapshot for subscribed boot path');
} else pass('App.js subscribed boot await preserved');

if (!app.includes('premiumPlaybackReady || isFree')) {
  fail('App.js must keep free-channel fast snapshot path');
} else pass('App.js free-channel fast path');

if (!banner.includes('resolveChannelTapAccessSnapshot')) {
  fail('BannerCarousel must use tap snapshot helper');
} else pass('BannerCarousel tap snapshot helper');

if (nav.includes('await openPaymentModal()')) {
  fail('payment modal must open synchronously for instant UI');
} else pass('payment modal opens synchronously');

if (app.includes('awaitRecoverBoot')) pass('boot recovery kept for subscribed boot path');
else fail('missing awaitRecoverBoot');

if (!process.exitCode) console.log('\n[verify-premium-playback-regression] ok');
