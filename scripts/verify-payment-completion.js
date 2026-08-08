#!/usr/bin/env node
'use strict';

/**
 * Payment completion — MFALME-aligned activation pipeline + instant entitlement trust.
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

if (!activation.includes('isPaymentEntitlementConfirmed')) fail('isPaymentEntitlementConfirmed');
else pass('isPaymentEntitlementConfirmed');

if (!activation.includes('recoverSubscription')) fail('activation probe includes recover');
else pass('activation probe includes recover');

if (activation.includes('refreshSubscription()')) {
  fail('activation tick must not join shared refreshSubscription');
} else pass('activation tick avoids shared reverify');

if (!modal.includes('schedulePostPaymentActivationPolls')) {
  fail('schedulePostPaymentActivationPolls');
} else pass('schedulePostPaymentActivationPolls');

if (modal.includes('moveToSuccessStep')) fail('remove legacy moveToSuccessStep');
else pass('no legacy moveToSuccessStep');

if (modal.includes('activationInFlightRef')) fail('must not block activation with in-flight guard');
else pass('no activation in-flight guard');

if (!modal.includes('finalizePaymentSuccess')) fail('finalizePaymentSuccess');
else pass('finalizePaymentSuccess');

if (!modal.includes('isPaymentEntitlementConfirmed')) {
  fail('poll must trust payment entitlement_active / ACTIVE');
} else pass('poll trusts payment entitlement confirmation');

if (!modal.includes('subscription_stream_active')) fail('subscription stream unlock');
else pass('subscription stream unlock');

const streamTrustsPayload =
  modal.includes('subscription_stream_active') &&
  !modal.match(/subscription_stream_active[\s\S]{0,400}verifySubscription/);
if (!streamTrustsPayload) fail('stream must unlock without waiting on verify');
else pass('stream unlocks without verify lag');

const schedBlock = modal.match(
  /const schedulePostPaymentActivationPolls[\s\S]*?},\s*\n\s*\[finalizePaymentSuccess, applyWaitingState\]/,
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

if (
  !modal.includes("'poll-status-light'") &&
  !modal.includes("'poll-probe'") &&
  !modal.includes('payment-status-success-immediate')
) {
  fail('poll activation source');
} else pass('poll activation source');

if (!modal.includes('payment-status-entitlement') && !modal.includes('payment-status-success-immediate')) {
  fail('payment-status entitlement unlock before probe');
} else pass('payment-status entitlement unlock before probe');

if (modal.includes("'poll-activating'")) {
  fail('must not double-probe via poll-activating after pollOnce probe');
} else pass('no double-probe poll-activating path');

const pollBlock = modal.match(/const pollOnce = useCallback[\s\S]*?},\s*\n\s*\[[\s\S]*?\]\s*,\s*\n\s*\);/);
if (pollBlock && pollBlock[0].includes('probeSubscriptionActivation(')) {
  fail('pollOnce must not block on subscription probes while PENDING');
} else pass('pollOnce does not block on subscription probes');

if (!activation.includes('probeSubscriptionStatusParallel')) {
  fail('parallel status probe');
} else pass('parallel status probe');

if (!activation.includes('light: true') && !activation.includes('light === true')) {
  fail('light probe mode');
} else pass('light probe mode');

if (!modal.includes('payment_sse') || !modal.includes('sse-payload')) {
  fail('SSE payload instant unlock during wait');
} else pass('SSE payload instant unlock during wait');

if (!modal.includes('registerDeviceIntelligence')) {
  fail('device profile refresh on payment success');
} else pass('device profile refresh on payment success');

if (!modal.includes("'payment_success'") || !modal.includes("'payment_completed'")) {
  fail('payment_success SSE listener');
} else pass('payment_success SSE listener');

if (!modal.includes('probeSubscriptionActivation')) {
  fail('poll uses dedicated probeSubscriptionActivation');
} else pass('poll uses dedicated probeSubscriptionActivation');

if (modal.includes('create_order_timeout_recovery') || modal.includes('create-order-timeout-recovery')) {
  fail('create-order timeout must not enter fake pending recovery');
} else pass('no create-order timeout recovery / fake pending');

if (!modal.includes('create_order_timeout_blocked')) fail('create-order timeout blocked path');
else pass('create-order timeout blocked path');

if (!errors.includes('isPaymentCreateOrderTimeout')) fail('create-order timeout detector');
else pass('create-order timeout detector');

if (!modal.includes('Missing order_id from server')) fail('order_id required before waiting UI');
else pass('order_id required before waiting UI');

if (modal.includes("useState('zenopay')")) fail('must not default checkoutProvider to zenopay');
else pass('checkoutProvider does not default to zenopay');

if (!payment.includes('COMPLETED')) fail('broaden payment success status');
else pass('broaden payment success status');

if (!payment.includes('expiresAt: parsed.expiresAt')) fail('payment status forwards expiresAt');
else pass('payment status forwards expiresAt');

if (!modal.includes('subscription_activated')) fail('subscription_activated SSE during wait');
else pass('subscription_activated SSE during wait');

if (!app.includes('pendingChannelAfterPaymentRef')) fail('pending channel after payment ref');
else pass('pending channel after payment ref');

if (
  !app.includes('openPremiumModal(freshPlayerChannel)') &&
  !app.includes('openPremiumModal(playerChannel)')
) {
  fail('store channel on premium tap');
} else pass('store channel on premium tap');

if (!app.includes("navigation.navigate('ChannelPlayer'")) fail('navigate to channel after payment');
else pass('navigate to channel after payment');

if (!banner.includes('fn(playerChannel)')) fail('banner passes channel to payment modal');
else pass('banner passes channel to payment modal');

if (process.exitCode) process.exit(1);
console.log('\n[verify-payment-completion] ok');
