#!/usr/bin/env node
'use strict';

/**
 * Sticky premium session + deferred wall-clock expiry guards.
 * Run: node scripts/verify-sticky-playback-deferred-expiry.js
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

const player = read('screens/ChannelPlayerScreen.js');
const ctx = read('context/OsmaniAppContext.jsx');

if (!player.includes('sticky_session_preserved')) {
  fail('player mount gate must preserve sticky session for channelKey');
} else pass('sticky session preserve log present');

if (!player.includes('premiumGateSessionRef.current.granted')) {
  fail('sticky check must use premiumGateSessionRef.granted');
} else pass('sticky uses premiumGateSessionRef.granted');

if (player.includes("runPlaybackTeardown('expiry_wallclock')")) {
  fail('wall-clock must not hard-teardown playback mid-watch');
} else pass('no hard wall-clock teardown');

if (player.includes("navigate('MainTabs', { screen: 'Home' })") &&
    player.includes('expiry_wallclock_start')) {
  fail('wall-clock must not navigate Home on clock cross');
} else pass('no wall-clock Home navigation path');

if (!player.includes('expiry_wallclock_deferred') && !player.includes('deferred_keep_session')) {
  fail('deferred wall-clock expiry markers required');
} else pass('deferred wall-clock markers present');

if (!player.includes('player-expiry-wallclock-deferred')) {
  fail('deferred wall-clock must silently reverify');
} else pass('deferred wall-clock silent reverify');

if (!player.includes('isConfirmedSubscriptionLoss(r)')) {
  fail('player-expiry-sync must still require confirmed loss');
} else pass('player-expiry-sync still uses confirmed loss');

if (!ctx.includes('lastBootResolveRef.current = effectiveResult')) {
  fail('reverify must update lastBootResolveRef for mid-session ERROR_UNKNOWN');
} else pass('lastBootResolveRef updated on reverify');

if (!ctx.includes("resolveSource: 'transport:error'")) {
  fail('verify catch path must tag transport:error resolveSource');
} else pass('transport:error resolveSource on verify catch');

if (!process.exitCode) {
  console.log('\n[verify-sticky-playback-deferred-expiry] ok');
}
