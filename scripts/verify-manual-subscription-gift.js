#!/usr/bin/env node
'use strict';

/**
 * MFALME manual subscription gift ack key — static + merge unit checks.
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
  [subApi, 'pickManualGiftAckKey', 'pickManualGiftAckKey in subscription API'],
  [subApi, 'acknowledgeManualGift', 'acknowledgeManualGift export'],
  [subApi, 'normalizeVerifyResponse', 'normalizeVerifyResponse'],
  [subApi, 'manualGiftAckKey', 'manualGiftAckKey in verify normalization'],
  [subApi, 'subRoot?.entitlement_remaining_seconds', 'subRoot entitlement fields'],
  [context, 'reverifySubscription', 'reverifySubscription in context'],
  [context, 'resolvedManualGiftAckKey', 'resolvedManualGiftAckKey from raw verify'],
  [context, 'r?.manualGiftAckKey', 'raw verify manualGiftAckKey preserved'],
  [context, 'mergeSubscriptionDetails(prev, { manualGiftAckKey', 'transport preserve gift key'],
  [context, 'hydrateSubscriptionFromCache', 'hydrateSubscriptionFromCache'],
  [app, 'tryShowManualGift', 'tryShowManualGift popup flow'],
  [app, 'acknowledgeManualGiftPress', 'acknowledgeManualGiftPress handler'],
  [app, 'ManualSubscriptionGiftModal', 'ManualSubscriptionGiftModal mounted'],
  [giftModal, 'ASANTE', 'gift modal ASANTE button'],
  [giftAck, 'writePendingManualGiftKey', 'pending gift key persistence'],
  [giftAck, 'writeManualGiftAck', 'acked gift key persistence'],
  [hydrate, 'manualGiftAckKey: result.manualGiftAckKey', 'verify result carries gift key'],
];

for (const [src, needle, label] of required) {
  if (!src.includes(needle)) fail(label);
  else pass(label);
}

if (
  /setSubscriptionDetails\(\(prev\)\s*=>\s*\n?\s*mergeSubscriptionDetails/.test(context) &&
  context.includes('hydrateSubscriptionFromCache')
) {
  pass('cache hydrate merges details via mergeSubscriptionDetails');
} else {
  fail('cache hydrate merges details via mergeSubscriptionDetails');
}

if (mergeSrc.includes('manualGiftAckKey: null')) {
  fail('plan snapshot/cache must not force manualGiftAckKey null');
} else pass('no forced null manualGiftAckKey in merge module');

if (!hydrate.includes('subscriptionDetailsFromCache')) {
  fail('subscriptionDetailsFromCache required');
} else {
  const cacheFn = hydrate.slice(
    hydrate.indexOf('export function subscriptionDetailsFromCache'),
    hydrate.indexOf('export function', hydrate.indexOf('export function subscriptionDetailsFromCache') + 1) ||
      hydrate.length,
  );
  if (cacheFn.includes('manualGiftAckKey: null')) {
    fail('sparse cache fallback must not wipe manualGiftAckKey');
  } else pass('sparse cache fallback preserves gift key slot');
}

const { mergeSubscriptionDetails } = require('../lib/subscriptionDetailsMerge');

const sticky = mergeSubscriptionDetails(
  { manualGiftAckKey: 'gift-abc', amount: 5000 },
  { manualGiftAckKey: null, expiresAt: '2026-12-01' },
);
if (sticky.manualGiftAckKey !== 'gift-abc') {
  fail('merge must stick manualGiftAckKey when incoming is null');
} else pass('merge sticks manualGiftAckKey on sparse incoming');

const incomingWins = mergeSubscriptionDetails(
  { manualGiftAckKey: 'gift-old' },
  { manualGiftAckKey: 'gift-new' },
);
if (incomingWins.manualGiftAckKey !== 'gift-new') {
  fail('incoming manualGiftAckKey must win when present');
} else pass('incoming manualGiftAckKey wins');

if (!process.exitCode) {
  console.log('\n[verify-manual-subscription-gift] ok');
}
