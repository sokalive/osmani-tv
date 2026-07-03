#!/usr/bin/env node
'use strict';

/**
 * MFALME manual subscription gift — static + normalization unit checks.
 * Run: node scripts/verify-manual-subscription-gift.js
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

const subApi = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
const context = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const mergeSrc = fs.readFileSync(path.join(root, 'lib', 'subscriptionDetailsMerge.js'), 'utf8');
const hydrate = fs.readFileSync(path.join(root, 'lib', 'subscriptionCacheHydrate.js'), 'utf8');
const giftModal = fs.readFileSync(
  path.join(root, 'components', 'ManualSubscriptionGiftModal.js'),
  'utf8',
);
const giftAck = fs.readFileSync(path.join(root, 'lib', 'manualGiftAck.js'), 'utf8');

const required = [
  [subApi, 'pickManualGiftShowPopup', 'pickManualGiftShowPopup gate'],
  [subApi, 'manualGiftShowPopup: pickManualGiftShowPopup(body)', 'normalize exports manualGiftShowPopup'],
  [subApi, 'pickManualGiftAckKey', 'pickManualGiftAckKey in subscription API'],
  [subApi, 'acknowledgeManualGift', 'acknowledgeManualGift export'],
  [subApi, 'normalizeVerifyResponse', 'normalizeVerifyResponse'],
  [context, 'resolvedManualGiftShowPopup', 'context gates gift key on showPopup'],
  [context, 'dismissManualGiftClientState', 'dismissManualGiftClientState export'],
  [context, 'manualGiftShowPopup: resolvedManualGiftShowPopup', 'context passes manualGiftShowPopup'],
  [app, 'manualGiftShowPopup === true', 'tryShowManualGift requires showPopup'],
  [app, 'isNoPendingManualGiftError', 'ack failure clears stale gift'],
  [app, 'dismissManualGiftClientState', 'App clears stale gift state'],
  [app, 'purgeStaleManualGiftPendingKey', 'App purges stale pending key'],
  [app, 'tryShowManualGift', 'tryShowManualGift popup flow'],
  [app, 'acknowledgeManualGiftPress', 'acknowledgeManualGiftPress handler'],
  [app, 'ManualSubscriptionGiftModal', 'ManualSubscriptionGiftModal mounted'],
  [giftModal, 'ASANTE', 'gift modal ASANTE button'],
  [giftAck, 'isNoPendingManualGiftError', 'no-pending error detector'],
  [giftAck, 'purgeStaleManualGiftPendingKey', 'purge stale pending helper'],
];

for (const [src, needle, label] of required) {
  if (!src.includes(needle)) fail(label);
  else pass(label);
}

const stickyMatch = mergeSrc.match(/stickyFields\s*=\s*\[([\s\S]*?)\]/);
if (stickyMatch && stickyMatch[1].includes('manualGiftAckKey')) {
  fail('manualGiftAckKey must not be a sticky merge field');
} else pass('manualGiftAckKey not sticky');

if (!subApi.includes('if (!pickManualGiftShowPopup(body)) return null;')) {
  fail('pickManualGiftAckKey must be gated on showPopup');
} else pass('pickManualGiftAckKey gated on showPopup');

if (app.includes("else if (pending !== '' && ack !== pending)")) {
  fail('pending-only popup path must be removed');
} else pass('no pending-only popup path');

const { mergeSubscriptionDetails } = require('../lib/subscriptionDetailsMerge');

const cleared = mergeSubscriptionDetails(
  { manualGiftAckKey: 'stale-key', manualGiftShowPopup: true, amount: 5000 },
  { manualGiftShowPopup: false, manualGiftAckKey: null, expiresAt: '2026-12-01' },
);
if (cleared.manualGiftAckKey != null) fail('merge must clear stale manualGiftAckKey');
else pass('merge clears stale manualGiftAckKey');
if (cleared.manualGiftShowPopup === true) fail('merge must clear showPopup when server says false');
else pass('merge clears showPopup');
if (cleared.amount !== 5000) fail('merge still preserves amount');
else pass('merge preserves amount');

if (!process.exitCode) {
  console.log('\n[verify-manual-subscription-gift] ok');
}
