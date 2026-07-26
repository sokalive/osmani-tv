#!/usr/bin/env node
'use strict';

/**
 * Instant premium entry + Lipia UX — no "Inathibitisha" wait, no Lipia network gate.
 * Run: node scripts/verify-instant-payment-ux.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function pass(msg) {
  console.log('PASS:', msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

const premium = read('components/PremiumModal.js');
const player = read('screens/ChannelPlayerScreen.js');
const payment = read('api/payment.js');
const guard = read('lib/phoneSubscriptionGuard.js');
const account = read('screens/AkauntiYanguScreen.js');
const context = read('context/OsmaniAppContext.jsx');

if (premium.includes("Inathibitisha kifurushi")) {
  fail('Inathibitisha kifurushi must be removed from PremiumModal UI');
} else {
  pass('Inathibitisha string removed from PremiumModal');
}

if (!premium.includes('silent: true')) fail('payment entry verify must be silent');
else pass('payment entry verify is silent');

if (premium.includes("await refreshSubscription('payment-submit-gate')")) {
  fail('Lipia must not await refreshSubscription before next step');
} else pass('Lipia does not await submit-gate verify');

const handleStart = premium.indexOf('const handleStep2Pay');
const handleBody = premium.slice(handleStart, handleStart + 4500);
if (handleBody.indexOf('setStep(3)') < 0) fail('Lipia must advance to waiting step');
else {
  const step3 = handleBody.indexOf('setStep(3)');
  const getId = handleBody.indexOf('getDeviceIdentity');
  const startPay = handleBody.indexOf('startPayment');
  if (getId >= 0 && step3 > getId) fail('setStep(3) must happen before await getDeviceIdentity');
  else if (startPay >= 0 && step3 > startPay) fail('setStep(3) must happen before startPayment await');
  else pass('Lipia advances to step 3 before any await');
}

if (premium.includes("Namba Hii Tayari Inatumika") || guard.includes("Namba Hii Tayari Inatumika")) {
  fail('must not show phone-ownership Already Active copy');
} else pass('no phone-ownership Already Active copy');

if (!guard.includes('kifaa hiki pekee')) fail('multi-device soft message required');
else pass('multi-device soft message present');

if (!account.includes('resolveAccountDisplayExpiresAt')) {
  fail('Account Box 4 must use plan-aligned display expiry');
} else pass('Account Box 4 uses plan-aligned display expiry');

if (!context.includes('skipped_hydrate_authoritative_inactive')) {
  fail('cache hydrate must skip after authoritative inactive');
} else pass('cache hydrate blocked after authoritative inactive');

if (/Inathibitisha kifurushi…/.test(player) && !player.includes("'Inafungua…'")) {
  fail('ChannelPlayer must not show Inathibitisha kifurushi');
} else if (player.includes("accessChecked ? 'Hauna kifurushi hai' : 'Inathibitisha")) {
  fail('ChannelPlayer gate text still uses Inathibitisha');
} else pass('ChannelPlayer Inathibitisha removed from UI');

if (!player.includes('denied_inactive_instant')) fail('player must exit inactive instantly');
else pass('player exits inactive instantly');

if (!guard.includes('DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION')) {
  fail('device-scoped conflict code required');
} else pass('device-scoped conflict code present');

if (!payment.includes('DeviceSubscriptionConflictError')) {
  fail('create-order must map device conflict separately from phone');
} else pass('device vs phone conflict separation');

if (!account.includes('startedAt: null')) {
  fail('Account progress must ignore stacked startedAt');
} else pass('Account progress ignores stacked startedAt');

if (!process.exitCode) {
  console.log('\n[verify-instant-payment-ux] ok');
}
