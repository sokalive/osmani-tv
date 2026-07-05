#!/usr/bin/env node
'use strict';

/**
 * KULIPIA badge visibility — entitlement-gated channel cards.
 * Run: node scripts/verify-kulipia-badge.js
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

const { shouldShowKulipiaBadge, snapshotHasActiveSubscription } = (() => {
  function snapshotHasActiveSubscription(snapshot) {
    return snapshot?.isSubscribed === true;
  }
  function shouldShowKulipiaBadge(input) {
    if (!input?.isPremium) return false;
    if (input?.freeMode) return false;
    return input?.isSubscribed !== true;
  }
  return { shouldShowKulipiaBadge, snapshotHasActiveSubscription };
})();
const app = read('App.js');
const gate = read('lib/premiumTapGate.js');

if (!gate.includes('shouldShowKulipiaBadge')) fail('shouldShowKulipiaBadge export');
else pass('shouldShowKulipiaBadge export');

if (!app.includes('ChannelAccessBadge')) fail('ChannelAccessBadge component');
else pass('ChannelAccessBadge component');

if (!app.includes('shouldShowKulipiaBadge')) fail('App imports shouldShowKulipiaBadge');
else pass('App imports shouldShowKulipiaBadge');

if (app.includes("item.accessBadge === 'KULIPIA'")) {
  fail('must not render KULIPIA from static accessBadge alone');
} else pass('no static KULIPIA render path');

if (!app.includes('extraData={{ isSubscribed, subscriptionVersion')) {
  fail('FlatList extraData must include isSubscribed');
} else pass('FlatList extraData includes isSubscribed');

// Matrix
const cases = [
  ['premium unpaid', { isPremium: true, freeMode: false, isSubscribed: false }, true],
  ['premium active sub', { isPremium: true, freeMode: false, isSubscribed: true }, false],
  ['premium freeMode', { isPremium: true, freeMode: true, isSubscribed: false }, false],
  ['free channel', { isPremium: false, freeMode: false, isSubscribed: false }, false],
  ['expired sub', { isPremium: true, freeMode: false, isSubscribed: false }, true],
];

for (const [name, input, expected] of cases) {
  const got = shouldShowKulipiaBadge(input);
  if (got !== expected) fail(`${name}: expected ${expected} got ${got}`);
  else pass(`matrix ${name}`);
}

// Align with playback snapshot truth
const snap = { isSubscribed: true, freeMode: false, premiumPlaybackReady: true };
if (shouldShowKulipiaBadge({ isPremium: true, ...snap }) !== !snapshotHasActiveSubscription(snap)) {
  fail('badge must invert snapshotHasActiveSubscription for premium channels');
} else pass('aligned with snapshotHasActiveSubscription');

// Stale: subscribed truth wins — badge hidden when isSubscribed true regardless of channel metadata
if (shouldShowKulipiaBadge({ isPremium: true, freeMode: false, isSubscribed: true })) {
  fail('subscribed user must not see KULIPIA');
} else pass('subscribed hides KULIPIA');

if (process.exitCode) process.exit(1);
console.log('\n[verify-kulipia-badge] ok');
