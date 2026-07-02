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
const app = read('App.js');
const banner = read('components/BannerCarousel.js');

if (!modal.includes('finalizePaymentSuccess')) fail('finalizePaymentSuccess');
else pass('finalizePaymentSuccess');

if (!modal.includes('attemptPaymentActivation')) fail('attemptPaymentActivation');
else pass('attemptPaymentActivation');

if (!modal.includes('activationInFlightRef')) fail('activation in-flight guard');
else pass('activation in-flight guard');

const attemptBlock = modal.match(/const attemptPaymentActivation[\s\S]*?},\s*\n\s*\[refreshSubscription, finalizePaymentSuccess\]/);
if (!attemptBlock || attemptBlock[0].includes('clearTimers();')) {
  fail('attemptPaymentActivation must not clear timers before success');
} else pass('polling survives failed activation attempt');

if (!modal.includes('onUnlockSuccess?.()')) fail('auto onUnlockSuccess');
else pass('auto onUnlockSuccess');

if (!modal.includes('onClose?.()')) fail('auto onClose after success');
else pass('auto onClose after success');

if (!modal.includes("source: 'poll-success'")) fail('poll success activation source');
else pass('poll success activation source');

if (!modal.includes("events = ['payment_success', 'payment_completed']")) {
  fail('payment_success SSE listener');
} else pass('payment_success SSE listener');

if (!modal.includes('PAYMENT_ACTIVATION_MAX_ATTEMPTS_CONFIRMED')) {
  fail('extended activation attempts when payment confirmed');
} else pass('extended activation attempts when payment confirmed');

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
