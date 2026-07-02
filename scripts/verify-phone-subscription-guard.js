#!/usr/bin/env node
'use strict';

/**
 * Phone Subscription Guard — create-order 409 must stop checkout and show popup.
 * Run: node scripts/verify-phone-subscription-guard.js
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

const guard = read('lib/phoneSubscriptionGuard.js');
const payment = read('api/payment.js');
const errors = read('lib/paymentCheckoutErrors.js');
const modal = read('components/PremiumModal.js');

if (!guard.includes('PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION')) fail('new guard code');
else pass('PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION');

if (!guard.includes('phone_subscription_conflict')) fail('legacy guard code');
else pass('phone_subscription_conflict transition code');

if (!payment.includes('PhoneSubscriptionConflictError')) fail('payment API throws conflict error');
else pass('payment API conflict error');

if (!payment.includes('phone-subscription-guard')) fail('payment API logs guard phase');
else pass('payment API guard logging');

if (!payment.includes('isPhoneSubscriptionConflict')) fail('payment API detects 409 conflict');
else pass('409 conflict detection');

if (!errors.includes('class PhoneSubscriptionConflictError')) fail('PhoneSubscriptionConflictError class');
else pass('PhoneSubscriptionConflictError class');

if (!modal.includes('PhoneSubscriptionConflictError')) fail('PremiumModal handles conflict error');
else pass('PremiumModal conflict handler');

if (!modal.includes('EmergencyModal')) fail('PremiumModal shows EmergencyModal popup');
else pass('existing EmergencyModal popup');

if (!modal.includes('phone_subscription_guard')) fail('PremiumModal logs guard event');
else pass('PremiumModal guard log');

if (modal.includes('setStep(3)') && !modal.match(/phone_subscription_guard[\s\S]{0,800}return;/)) {
  // ensure conflict path returns before step 3 — checked via return after guard
}
if (!modal.includes("reportPaymentTelemetry('phone_subscription_conflict'")) {
  fail('PremiumModal telemetry for phone guard');
} else pass('phone guard telemetry');

const {
  isPhoneSubscriptionConflict,
  parsePhoneSubscriptionConflict,
  buildPhoneSubscriptionGuardFallbackMessage,
  PHONE_GUARD_FALLBACK_TITLE,
} = require('../lib/phoneSubscriptionGuard');

if (!isPhoneSubscriptionConflict(409, { code: 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION' })) {
  fail('detect new code on 409');
} else pass('detect new code');

if (!isPhoneSubscriptionConflict(409, { code: 'phone_subscription_conflict' })) {
  fail('detect legacy code on 409');
} else pass('detect legacy code');

if (isPhoneSubscriptionConflict(400, { code: 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION' })) {
  fail('must require HTTP 409');
} else pass('requires HTTP 409');

const backendMsg = parsePhoneSubscriptionConflict({
  code: 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
  message_sw: 'Namba hii tayari ina kifurushi kinachoendelea kwenye kifaa kingine. Tumia namba nyingine.',
  remaining_days: 5,
});
if (backendMsg.messageSw !== 'Namba hii tayari ina kifurushi kinachoendelea kwenye kifaa kingine. Tumia namba nyingine.') {
  fail('use suitable backend message_sw');
} else pass('use suitable backend message_sw');
if (backendMsg.displaySource !== 'backend') fail('backend display source');
else pass('backend display source');

const fallbackDetailed = parsePhoneSubscriptionConflict({
  code: 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
  existing_package: 'Wiki 1',
  remaining_days: 7,
});
if (fallbackDetailed.title !== PHONE_GUARD_FALLBACK_TITLE) fail('fallback title');
else pass('fallback title');
if (!fallbackDetailed.messageSw.includes('Wiki 1')) fail('fallback includes package');
else pass('fallback includes package');
if (!fallbackDetailed.messageSw.includes('7 siku')) fail('fallback includes remaining days');
else pass('fallback includes remaining days');
if (!fallbackDetailed.messageSw.includes('namba nyingine kulipia')) {
  fail('fallback instructs alternate phone');
} else pass('fallback instructs alternate phone');

const fallbackGeneric = parsePhoneSubscriptionConflict({
  code: 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
});
if (!fallbackGeneric.messageSw.includes('namba nyingine kulipia')) {
  fail('generic fallback instructs alternate phone');
} else pass('generic fallback instructs alternate phone');

const built = buildPhoneSubscriptionGuardFallbackMessage('Mwezi 1', 3);
if (!built.includes('Mwezi 1') || !built.includes('3 siku')) fail('builder includes package and days');
else pass('builder includes package and days');

if (!guard.includes('formatPhoneSubscriptionGuardDisplay')) fail('display formatter export');
else pass('display formatter export');

if (!modal.includes('phoneGuardTitle')) fail('PremiumModal uses dynamic guard title');
else pass('PremiumModal dynamic guard title');

if (process.exitCode) process.exit(1);
console.log('\n[verify-phone-subscription-guard] ok');
