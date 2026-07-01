#!/usr/bin/env node
'use strict';

/**
 * Premium playback regression — restore a99a906 snapshot gate vs HEAD instant snapshot.
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

if (!app.includes('await awaitPremiumAccessSnapshot()')) {
  fail('App.js must await premium access snapshot when sync not ready');
} else pass('App.js awaitPremiumAccessSnapshot restored');

if (!app.includes('premiumPlaybackReady || isFree')) {
  fail('App.js must keep free-channel fast snapshot path');
} else pass('App.js free-channel fast path');

if (!banner.includes('await awaitPremiumAccessSnapshot')) {
  fail('BannerCarousel must await premium access snapshot');
} else pass('BannerCarousel awaitPremiumAccessSnapshot restored');

if (app.includes("logChannelCardTap('snapshot_immediate'")) {
  fail('App.js must not use snapshot_immediate without await');
} else pass('no snapshot_immediate regression');

if (!nav.includes('await openPaymentModal()')) {
  fail('premiumChannelNavigation must await payment modal');
} else pass('payment modal awaited');

if (app.includes('awaitRecoverBoot')) pass('boot recovery kept on premium tap');
else fail('missing awaitRecoverBoot');

if (!process.exitCode) console.log('\n[verify-premium-playback-regression] ok');
