#!/usr/bin/env node
'use strict';

/**
 * Regression: Issue1 Kifurushi gate, Issue2 in-session OTA, Issue3 Akaunti screenshots.
 * Run: node scripts/verify-app-issues-triple.js
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const root = path.join(__dirname, '..');
const requireCjs = createRequire(__filename);

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

const modal = read('components/PremiumModal.js');
const ota = read('lib/expoUpdatesClient.js');
const gate = read('lib/otaSessionGate.js');
const policy = read('lib/security/screenshotPolicy.js');
const akaunti = read('screens/AkauntiYanguScreen.js');
const player = read('screens/ChannelPlayerScreen.js');
const secure = read('lib/security/secureScreen.js');

// --- Issue 1 ---
if (!modal.includes('checkoutSessionRef')) fail('checkout session ref');
else pass('checkout session ref');

if (!modal.includes("checkoutSessionRef.current = 'waiting'")) fail('waiting session mark');
else pass('waiting session mark');

if (!modal.includes("checkoutSessionRef.current = 'success'")) fail('success session mark');
else pass('success session mark');

if (!modal.includes('payment_submit_gate_ignored_after_checkout_start')) {
  fail('submit gate ignored after checkout start');
} else pass('submit gate ignored after checkout start');

if (!modal.includes("setPhoneGuardVisible(false)")) fail('dismiss guard on success');
else pass('dismiss guard on success');

if (!modal.includes("checkoutSessionRef.current === 'waiting'")) {
  fail('showPaymentEntryDialog blocks waiting session');
} else pass('entry dialog blocked during waiting/success');

// --- Issue 2 ---
if (!ota.includes('IN_SESSION_RECHECK_MS')) fail('in-session OTA interval');
else pass('in-session OTA interval');

if (!ota.includes('ota_reload_deferred_playback')) fail('defer reload during playback');
else pass('defer reload during playback');

if (!ota.includes('applyPendingExpoUpdateIfAny')) fail('apply pending after playback');
else pass('apply pending after playback');

if (!gate.includes('setChannelPlaybackActive')) fail('playback gate module');
else pass('playback gate module');

if (!player.includes('setChannelPlaybackActive(true)')) fail('player marks playback active');
else pass('player marks playback active');

if (!ota.includes('scheduleInSessionSync')) fail('schedule in-session sync');
else pass('schedule in-session sync');

// --- Issue 3 ---
if (!policy.includes("allow_akaunti")) fail('akaunti screenshot policy');
else pass('akaunti screenshot policy');

if (!akaunti.includes("setScreenshotPolicy('allow_akaunti')")) fail('Akaunti allows screenshots');
else pass('Akaunti allows screenshots');

if (!akaunti.includes("setScreenshotPolicy('protect')")) fail('Akaunti restores protect on blur');
else pass('Akaunti restores protect on blur');

if (!secure.includes('applyScreenshotPolicy') && !secure.includes('setScreenshotPolicy')) {
  fail('secureScreen uses screenshot policy');
} else pass('secureScreen uses screenshot policy');

try {
  const { setChannelPlaybackActive, isChannelPlaybackActive } = requireCjs('../lib/otaSessionGate.js');
  setChannelPlaybackActive(true);
  if (!isChannelPlaybackActive()) fail('playback gate true');
  else pass('playback gate true');
  setChannelPlaybackActive(false);
  if (isChannelPlaybackActive()) fail('playback gate false');
  else pass('playback gate false');
} catch (e) {
  fail(`otaSessionGate require: ${e.message}`);
}

if (process.exitCode) process.exit(1);
console.log('\n[verify-app-issues-triple] ok');
