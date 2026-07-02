#!/usr/bin/env node
'use strict';

/**
 * Payment completion — MFALME-aligned activation pipeline.
 * Run: node scripts/verify-payment-completion.js
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

const modal = read('components/PremiumModal.js');
const payment = read('api/payment.js');
const activation = read('lib/paymentActivation.js');
const fetchLib = read('lib/catalogApiFetch.js');
const errors = read('lib/paymentCheckoutErrors.js');
const app = read('App.js');
const banner = read('components/BannerCarousel.js');

if (!payment.includes('noTimeout: PAYMENT_CREATE_ORDER_NO_TIMEOUT')) {
  fail('create-order must not abort (MFALME no-timeout)');
} else pass('create-order no-timeout (MFALME parity)');

if (!fetchLib.includes('noTimeout')) fail('catalogApiFetch noTimeout support');
else pass('catalogApiFetch noTimeout support');

if (!activation.includes('runPaymentActivationTick')) fail('runPaymentActivationTick');
else pass('runPaymentActivationTick');

if (!activation.includes('probeSubscriptionActivation')) fail('probeSubscriptionActivation module');
else pass('probeSubscriptionActivation module');

if (!modal.includes('schedulePostPaymentActivationPolls')) {
  fail('schedulePostPaymentActivationPolls');
} else pass('schedulePostPaymentActivationPolls');

if (modal.includes('moveToSuccessStep')) fail('remove legacy moveToSuccessStep');
else pass('no legacy moveToSuccessStep');

if (modal.includes('activationInFlightRef')) fail('must not block activation with in-flight guard');
else pass('no activation in-flight guard');

if (!modal.includes('finalizePaymentSuccess')) fail('finalizePaymentSuccess');
else pass('finalizePaymentSuccess');

const schedBlock = modal.match(
  /const schedulePostPaymentActivationPolls[\s\S]*?},\s*\n\s*\[refreshSubscription, finalizePaymentSuccess\]/,
);
if (!schedBlock || schedBlock[0].includes('clearTimers();')) {
  fail('schedulePostPaymentActivationPolls must not clear timers before success');
} else pass('polling survives failed activation attempt');

if (!modal.includes('onUnlockSuccess?.()')) fail('onUnlockSuccess on FUNGUA CHANNEL');
else pass('onUnlockSuccess on FUNGUA CHANNEL');

if (!modal.includes('handleOpenChannel')) fail('handleOpenChannel');
else pass('handleOpenChannel');

if (!modal.includes('PaymentSuccessStep')) fail('PaymentSuccessStep');
else pass('PaymentSuccessStep');

if (modal.includes('ENDELEA')) fail('no ENDELEA on payment success');
else pass('no ENDELEA on payment success');

if (!modal.includes("source: 'poll-success'")) fail('poll success activation source');
else pass('poll success activation source');

if (!modal.includes("'payment_success'") || !modal.includes("'payment_completed'")) {
  fail('payment_success SSE listener');
} else pass('payment_success SSE listener');

if (!modal.includes('verifySubscription(deviceId, deviceFingerprint)')) {
  fail('poll peek uses verifySubscription (MFALME order)');
} else pass('poll peek uses verifySubscription');

if (!modal.includes('create_order_timeout_recovery')) fail('create-order timeout recovery path');
else pass('create-order timeout recovery path');

if (!errors.includes('isPaymentCreateOrderTimeout')) fail('create-order timeout detector');
else pass('create-order timeout detector');

if (!payment.includes('COMPLETED')) fail('broaden payment success status');
else pass('broaden payment success status');

if (!modal.includes('subscription_activated')) fail('subscription_activated SSE during wait');
else pass('subscription_activated SSE during wait');

if (!app.includes('pendingChannelAfterPaymentRef')) fail('pending channel after payment ref');
else pass('pending channel after payment ref');

if (!app.includes('openPremiumModal(playerChannel)')) fail('store channel on premium tap');
else pass('store channel on premium tap');

if (!app.includes("navigation.navigate('ChannelPlayer'")) fail('navigate to channel after payment');
else pass('navigate to channel after payment');

if (!banner.includes('fn(playerChannel)')) fail('banner passes channel to payment modal');
else pass('banner passes channel to payment modal');

if (process.exitCode) process.exit(1);
console.log('\n[verify-payment-completion] ok');
