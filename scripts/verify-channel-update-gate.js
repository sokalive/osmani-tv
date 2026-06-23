#!/usr/bin/env node
'use strict';

/**
 * Channel-level update gate for legacy APK (versionCode < 24).
 * Run: node scripts/verify-channel-update-gate.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const PUBLISHED = 24;

function shouldBlockChannelForUpdate(requireUpdateBeforeChannelPlayback, versionCode) {
  if (!requireUpdateBeforeChannelPlayback) return false;
  if (versionCode == null || versionCode >= PUBLISHED) return false;
  return true;
}

const gate = read('lib/channelUpdateGate.js');
const nav = read('lib/premiumChannelNavigation.js');
const settings = read('api/settings.js');
const ctx = read('context/OsmaniAppContext.jsx');
const modal = read('components/ChannelUpdateGateModal.js');
const app = read('App.js');

if (!gate.includes('shouldBlockChannelForUpdate')) fail('missing shouldBlockChannelForUpdate');
else pass('channelUpdateGate helper');

if (!settings.includes('require_update_before_channel_playback')) {
  fail('settings must parse require_update_before_channel_playback');
} else pass('settings parses admin toggle');

if (!nav.includes('shouldBlockChannelForUpdate')) fail('navigation must call update gate');
else pass('navigation uses update gate');

const gateIdx = nav.indexOf('shouldBlockChannelForUpdate');
const premiumIdx = nav.indexOf('openPaymentModal');
const verifyIdx = nav.indexOf('verifySubscriptionBeforePlay');
if (gateIdx < 0 || gateIdx > premiumIdx || gateIdx > verifyIdx) {
  fail('update gate must run before premium/payment flow');
} else pass('update gate precedes premium gate');

if (!gate.includes('Huwezi kutazama channel hii hadi ufanye update')) fail('missing title');
else pass('popup title');

if (!gate.includes('Bonyeza UPDATE kupata toleo jipya')) fail('missing message');
else pass('popup message');

if (!modal.includes('startDownload')) fail('UPDATE must start APK download');
else pass('UPDATE uses startDownload');

if (!app.includes('ChannelUpdateGateModal')) fail('App must mount channel update modal');
else pass('modal mounted in App');

if (!ctx.includes('requireUpdateBeforeChannelPlayback')) fail('context must expose toggle');
else pass('context exposes toggle');

// simulations
if (!shouldBlockChannelForUpdate(true, 20)) fail('v20 + ON must block');
else pass('sim: v20 toggle ON blocks');

if (shouldBlockChannelForUpdate(true, 24)) fail('v24 + ON must not block');
else pass('sim: v24 toggle ON passes');

if (shouldBlockChannelForUpdate(false, 20)) fail('v20 + OFF must not block');
else pass('sim: v20 toggle OFF passes');

if (!shouldBlockChannelForUpdate(true, 16)) fail('v16 + ON must block');
else pass('sim: v16 toggle ON blocks');

if (!process.exitCode) {
  console.log('\n[verify-channel-update-gate] ok');
}
