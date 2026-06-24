#!/usr/bin/env node
'use strict';

/**
 * Channel update gate + modal priority coordination.
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

// mirror lib/modalPriorityGuard.js
function evaluateChannelUpdateGatePresentation(opts = {}) {
  const EXACT = new Set([
    'lifecycle-revoked',
    'lifecycle-transfer',
    'lifecycle-plans',
    'global-payment-modal',
    'global-emergency',
    'device-intelligence-blocked',
    'update-overlay',
  ]);
  const hasHigher = (ids) =>
    (ids || []).some(
      (id) =>
        EXACT.has(id) ||
        id.startsWith('catalog-premium-') ||
        id.startsWith('catalog-manual-gift-'),
    );
  if (opts.channelUpdateGateVisible) return { defer: false, reason: 'already_visible' };
  if (opts.mandatoryUpdateOverlayActive) return { defer: true, reason: 'mandatory_update_overlay' };
  if (opts.updateOverlayVisible) return { defer: true, reason: 'update_overlay' };
  if (opts.sourceTransferSuccessVisible) return { defer: true, reason: 'transfer_success' };
  if (hasHigher(opts.blockingSheetIds)) return { defer: true, reason: 'blocking_sheet' };
  return { defer: false, reason: null };
}

const gate = read('lib/channelUpdateGate.js');
const priority = read('lib/modalPriorityGuard.js');
const nav = read('lib/premiumChannelNavigation.js');
const host = read('components/ChannelUpdateGateHost.jsx');
const updateClient = read('lib/updateClient.js');
const overlay = read('components/UpdateOverlay.js');
const app = read('App.js');

if (!gate.includes('shouldBlockChannelForUpdate')) fail('missing shouldBlockChannelForUpdate');
else pass('channelUpdateGate helper');

if (!priority.includes('evaluateChannelUpdateGatePresentation')) fail('missing modal priority guard');
else pass('modal priority guard');

if (!host.includes('evaluateChannelUpdateGatePresentation')) fail('host must use priority guard');
else pass('ChannelUpdateGateHost coordinates priority');

if (!host.includes('useRegisterBlockingSheet')) fail('channel gate must register blocking sheet');
else pass('channel gate registers coordinator id');

if (!updateClient.includes('isMandatoryUpdateOverlayActive')) fail('updateClient exports mandatory overlay check');
else pass('mandatory overlay export');

if (!updateClient.includes('isUpdateOverlayVisible')) fail('updateClient exports overlay visible check');
else pass('update overlay visible export');

if (!overlay.includes("useRegisterBlockingSheet('update-overlay'")) {
  fail('UpdateOverlay must register blocking sheet');
} else pass('UpdateOverlay registers coordinator');

const gateIdx = nav.indexOf('shouldBlockChannelForUpdate');
const premiumIdx = nav.indexOf('openPaymentModal');
if (gateIdx < 0 || gateIdx > premiumIdx) fail('update gate must precede premium gate');
else pass('update gate precedes premium gate');

if (!nav.includes('channel_update_gate_deferred')) fail('navigation must log deferred gate');
else pass('deferred gate logging');

if (!app.includes('ChannelUpdateGateHost')) fail('App must mount ChannelUpdateGateHost');
else pass('ChannelUpdateGateHost mounted');

// priority simulations
const mandatory = evaluateChannelUpdateGatePresentation({ mandatoryUpdateOverlayActive: true });
if (!mandatory.defer || mandatory.reason !== 'mandatory_update_overlay') {
  fail('sim: mandatory update blocks channel gate');
} else pass('sim: mandatory update blocks channel gate');

const soft = evaluateChannelUpdateGatePresentation({ updateOverlayVisible: true });
if (!soft.defer) fail('sim: any update overlay blocks channel gate');
else pass('sim: update overlay blocks channel gate');

const revoked = evaluateChannelUpdateGatePresentation({ blockingSheetIds: ['lifecycle-revoked'] });
if (!revoked.defer) fail('sim: revoked modal blocks channel gate');
else pass('sim: revoked modal blocks channel gate');

const payment = evaluateChannelUpdateGatePresentation({ blockingSheetIds: ['global-payment-modal'] });
if (!payment.defer) fail('sim: payment modal blocks channel gate');
else pass('sim: payment modal blocks channel gate');

const ok = evaluateChannelUpdateGatePresentation({ blockingSheetIds: [] });
if (ok.defer) fail('sim: clean state allows channel gate');
else pass('sim: clean state allows channel gate');

if (!shouldBlockChannelForUpdate(true, 20)) fail('v20 + ON must block playback');
else pass('sim: v20 toggle ON blocks');

if (shouldBlockChannelForUpdate(true, 24)) fail('v24 + ON must not block');
else pass('sim: v24 toggle ON passes');

if (!process.exitCode) {
  console.log('\n[verify-channel-update-gate] ok');
}
