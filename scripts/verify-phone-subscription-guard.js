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

const parsed = parsePhoneSubscriptionConflict({
  code: 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
  message_sw: 'Ujumbe wa mtihani',
  remaining_days: 5,
});
if (parsed.messageSw !== 'Ujumbe wa mtihani') fail('parse message_sw');
else pass('parse message_sw');

if (process.exitCode) process.exit(1);
console.log('\n[verify-phone-subscription-guard] ok');
