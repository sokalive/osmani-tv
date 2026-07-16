#!/usr/bin/env node
'use strict';

/**
 * VPS v24 — Kifurushi kimekwisha player gate must never render; stale bundles must OTA-reload.
 * Run: node scripts/verify-remove-kifurushi-kimekwisha-popup.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'lib/otaBootGatePolicy.js'), 'utf8');
const marker = fs.readFileSync(path.join(root, 'lib/playbackGateCapability.js'), 'utf8');

let failed = false;
function fail(msg) {
  console.error('FAIL:', msg);
  failed = true;
}
function pass(msg) {
  console.log('PASS:', msg);
}

if (/Kifurushi kimekwisha/i.test(player)) {
  fail('ChannelPlayerScreen must not contain Kifurushi kimekwisha copy');
} else pass('player gate copy removed');

if (/playbackSuppressed|setPlaybackSuppressed/.test(player)) {
  fail('playbackSuppressed state must not re-trigger the removed gate screen');
} else pass('no playbackSuppressed state');

if (!player.includes('trialPlaybackEndedRef') || !player.includes('hardWallClockExpiryDoneRef')) {
  fail('expiry/trial shutdown must use refs without gate re-render');
} else pass('shutdown uses refs only');

if (!player.includes('!isSubscribed')) {
  fail('premium expiry tick must require isSubscribed');
} else pass('expiry tick gated on isSubscribed');

if (!marker.includes('KIFURUSHI_KIMEKWISHA_GATE_REMOVED')) {
  fail('playbackGateCapability marker missing');
} else pass('OTA capability marker present');

if (!policy.includes('hasKifurushiKimekwishaGateRemoved')) {
  fail('otaBootGatePolicy must detect missing popup-removal marker');
} else pass('stale bundle detection wired');

if (!player.includes('Hauna kifurushi hai')) {
  fail('premium access gate must remain');
} else pass('premium access gate unchanged');

process.exit(failed ? 1 : 0);
