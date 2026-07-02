#!/usr/bin/env node
'use strict';

/**
 * Payment completion — auto-close waiting UI, keep polling alive until activation.
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
const app = read('App.js');
const banner = read('components/BannerCarousel.js');

if (!modal.includes('finalizePaymentSuccess')) fail('finalizePaymentSuccess');
else pass('finalizePaymentSuccess');

if (!modal.includes('const moveToSuccessStep = useCallback')) fail('moveToSuccessStep');
else pass('moveToSuccessStep');

if (modal.includes('activationInFlightRef')) fail('must not block activation with in-flight guard');
else pass('no activation in-flight guard');

const moveBlock = modal.match(/const moveToSuccessStep[\s\S]*?},\s*\n\s*\[refreshSubscription, finalizePaymentSuccess\]/);
if (!moveBlock || moveBlock[0].includes('clearTimers();')) {
  fail('moveToSuccessStep must not clear timers before success');
} else pass('polling survives failed activation attempt');

if (!modal.includes('onUnlockSuccess?.()')) fail('auto onUnlockSuccess');
else pass('auto onUnlockSuccess');

if (!modal.includes('onClose?.()')) fail('auto onClose after success');
else pass('auto onClose after success');

if (!modal.includes("source: 'poll-success'")) fail('poll success activation source');
else pass('poll success activation source');

if (!modal.includes("'payment_success'") || !modal.includes("'payment_completed'")) {
  fail('payment_success SSE listener');
} else pass('payment_success SSE listener');

if (!modal.includes('probeSubscriptionActivation')) fail('fast subscription probe');
else pass('fast subscription probe');

if (!modal.includes('getSubscriptionStatusForDevice')) fail('status probe during activation');
else pass('status probe during activation');

if (!payment.includes('COMPLETED')) fail('broaden payment success status');
else pass('broaden payment success status');

if (!modal.includes('subscription_activated')) fail('subscription_activated SSE during wait');
else pass('subscription_activated SSE during wait');

if (!modal.includes('PAYMENT_ACTIVATION_MAX_ATTEMPTS_CONFIRMED')) {
  fail('extended activation attempts when payment confirmed');
} else pass('extended activation attempts when payment confirmed');

if (!modal.includes('PAYMENT_ACTIVATION_RETRY_MS = 750')) {
  fail('stable a99a906 activation retry interval');
} else pass('stable a99a906 activation retry interval');

if (!modal.includes('peek && isSubscriptionActive(peek)')) {
  fail('poll verifies subscription before payment SUCCESS');
} else pass('poll peek-before-success order');

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
