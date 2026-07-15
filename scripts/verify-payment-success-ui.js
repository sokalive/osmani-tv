#!/usr/bin/env node
'use strict';

/**
 * Payment success dialog — Hongera copy + expiry + Fungua Channel.
 * Run: node scripts/verify-payment-success-ui.js
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
const successStep = read('components/PaymentSuccessStep.js');
const display = read('lib/paymentSuccessDisplay.js');

if (!modal.includes('PaymentSuccessStep')) fail('PremiumModal uses PaymentSuccessStep');
else pass('PremiumModal uses PaymentSuccessStep');

if (!modal.includes('buildPaymentSuccessDetails')) fail('buildPaymentSuccessDetails in modal');
else pass('buildPaymentSuccessDetails in modal');

if (!modal.includes('handleOpenChannel')) fail('handleOpenChannel');
else pass('handleOpenChannel');

if (!modal.includes('handleDismissSuccess')) fail('handleDismissSuccess / Funga');
else pass('handleDismissSuccess / Funga');

if (!modal.includes("refreshSubscription('payment-fungua-channel')")) {
  fail('FUNGUA CHANNEL must refresh entitlement once');
} else pass('FUNGUA CHANNEL refreshes entitlement');

if (modal.includes('ENDELEA')) fail('must not show ENDELEA on success');
else pass('no ENDELEA on success');

if (!modal.includes('setStep(4)')) fail('success step after verification');
else pass('success step after verification');

if (modal.includes('payment_complete_auto_close')) {
  fail('must not auto-close before success dialog');
} else pass('no auto-close before success dialog');

if (!successStep.includes('🎉 Hongera!')) fail('Hongera title');
else pass('Hongera title');

if (!successStep.includes('Malipo yako yamefanikiwa na kifurushi chako kimewashwa kikamilifu')) {
  fail('success body opening');
} else pass('success body opening');

if (!successStep.includes('Fungua Channel')) fail('Fungua Channel button');
else pass('Fungua Channel button');

if (!successStep.includes('Funga')) fail('optional Funga button');
else pass('optional Funga button');

if (!successStep.includes('Kifurushi chako kitaisha tarehe')) fail('expiry label');
else pass('expiry label');

if (!successStep.includes('Asante kwa kuchagua Osmani TV')) fail('thanks line');
else pass('thanks line');

if (!successStep.includes('formatExpiryDateDMY')) fail('DD/MM/YYYY formatter wiring');
else pass('DD/MM/YYYY formatter wiring');

if (!display.includes('formatExpiryDateDMY')) fail('formatExpiryDateDMY helper');
else pass('formatExpiryDateDMY helper');

if (successStep.includes('computeSubscriptionProgress')) {
  fail('success UI must not compute subscription progress');
} else pass('no local subscription math in success UI');

if (process.exitCode) process.exit(1);
console.log('\n[verify-payment-success-ui] ok');
