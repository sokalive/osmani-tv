#!/usr/bin/env node
'use strict';

/**
 * Static regression: channel card tap must not block on subscription sync for free channels.
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
const diag = read('lib/channelCardTapDiagnostics.js');

if (!diag.includes('[CHANNEL_CARD_TAP]')) fail('diagnostics prefix');
else pass('diagnostics module');

if (!app.includes('logChannelCardTap')) fail('App.js must log channel taps');
else pass('App.js tap logging');

if (!app.includes('channelIsFreeAccess')) fail('App.js must use channelIsFreeAccess for sync snapshot');
else pass('free channel sync snapshot');

const tap = read('lib/premiumChannelTapSnapshot.js');

if (!app.includes('resolveChannelTapAccessSnapshot')) fail('App.js must use payment-immediate tap snapshot');
else pass('payment-immediate tap snapshot helper');

if (!app.includes('snapshot_payment_immediate')) fail('App.js must log payment-immediate snapshot');
else pass('payment-immediate tap logging');

if (!tap.includes('await awaitPremiumAccessSnapshot()')) {
  fail('subscribed tap must still await snapshot when sync says active');
} else pass('awaitPremiumAccessSnapshot for subscribed boot path');

if (!tap.includes('getPremiumAccessSnapshot()')) fail('sync snapshot path missing');
else pass('getPremiumAccessSnapshot fast path');

if (app.includes('if (item.isPremium && !freeMode && !premiumPlaybackReady)')) {
  fail('redundant premium await in handleCardPress must be removed');
} else pass('no redundant premium await in handleCardPress');

if (!app.includes('delayPressIn={0}')) fail('Pressable delayPressIn=0 for Android tap reliability');
else pass('delayPressIn=0 on cards');

if (!nav.includes('shouldApplyTrialWatch')) fail('skip async trial when trial disabled');
else pass('sync trial gate before payment modal');

if (process.exitCode) process.exit(1);
console.log('\n[verify-channel-card-tap] ok');
