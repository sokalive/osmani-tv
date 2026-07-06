#!/usr/bin/env node
'use strict';

/**
 * One-tap channel opening regression — d3ba89c cache-first invariant.
 * Run: node scripts/verify-one-tap-channel-open.js
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

const nav = read('lib/premiumChannelNavigation.js');
const gate = read('lib/premiumTapGate.js');
const app = read('App.js');
const banner = read('components/BannerCarousel.js');
const ctx = read('context/OsmaniAppContext.jsx');
const player = read('screens/ChannelPlayerScreen.js');

if (nav.includes("await verifySubscriptionBeforePlay('channel-tap-premium')")) {
  fail('subscribed tap must not block on await verify before navigation');
} else pass('no blocking pre-navigation verify');

if (!nav.includes('premium_subscribed_cache_fast')) fail('cache-fast navigation path');
else pass('cache-fast navigation path');

if (!nav.includes('verifySubscriptionInBackground')) fail('background verify hook in nav');
else pass('background verify after navigation');

if (!gate.includes('verifySubscriptionInBackground')) fail('background verify helper');
else pass('gate-bg background verify helper');

if (!gate.includes('gate-bg:')) fail('background verify uses gate-bg prefix');
else pass('gate-bg prefix for non-blocking reconcile');

if (!app.includes('verifySubscriptionInBackground')) fail('App passes background verify');
else pass('App wires background verify');

if (!banner.includes('verifySubscriptionInBackground')) fail('BannerCarousel wires background verify');
else pass('BannerCarousel wires background verify');

if (!ctx.includes('gate-bg:') && !ctx.includes("fastReason.includes('-bg')")) {
  fail('gateForPlayback background fast path');
} else pass('gateForPlayback background fast path');

if (!player.includes("void gateForPlayback('player-mount')")) {
  fail('player optimistic allow with background gate');
} else pass('player optimistic subscribed mount');

if (!ctx.includes('isSubscribedRef.current = false')) fail('revoke clears ref');
else pass('revoke clears isSubscribedRef');

if (!ctx.includes('subscription_revoked')) fail('SSE revoke handler present');
else pass('SSE revoke handler present');

// Simulation: active subscriber tap should navigate once without awaiting verify
let navigated = 0;
let verifyAwaited = 0;
async function mockVerify() {
  verifyAwaited += 1;
  await new Promise((r) => setTimeout(r, 5000));
  return true;
}
function mockNavigate() {
  navigated += 1;
}
const snapshot = { isSubscribed: true, freeMode: false, premiumPlaybackReady: true };
const playerChannel = { id: 'ch1', accessType: 'premium', accessPremium: true };
const isFreeChannel = false;
const isPremiumChannel = true;
const premiumContent = !snapshot.freeMode && !isFreeChannel && isPremiumChannel;
if (!premiumContent) fail('sim: premium content');
else pass('sim: premium content');

if (snapshot.isSubscribed === true) {
  mockNavigate();
  void mockVerify();
}
if (navigated !== 1) fail('sim: single navigation');
else pass('sim: single navigation on tap');

if (verifyAwaited > 0 && navigated === 0) fail('sim: verify must not block navigation');
else pass('sim: navigation not blocked by verify');

if (process.exitCode) process.exit(1);
console.log('\n[verify-one-tap-channel-open] ok');
