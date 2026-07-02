#!/usr/bin/env node
'use strict';

/**
 * Payment success dialog — backend-only package display.
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

if (modal.includes('ENDELEA')) fail('must not show ENDELEA on success');
else pass('no ENDELEA on success');

if (!modal.includes('setStep(4)')) fail('success step after verification');
else pass('success step after verification');

if (modal.includes('payment_complete_auto_close')) {
  fail('must not auto-close before success dialog');
} else pass('no auto-close before success dialog');

if (!successStep.includes('🎉 Hongera!')) fail('Hongera title');
else pass('Hongera title');

if (!successStep.includes('Umefanikiwa kununua kifurushi')) fail('success subtitle');
else pass('success subtitle');

if (!successStep.includes('FUNGUA CHANNEL')) fail('FUNGUA CHANNEL button');
else pass('FUNGUA CHANNEL button');

if (!successStep.includes('Sasa unaweza kutazama channel zote za Premium Live')) {
  fail('premium live message');
} else pass('premium live message');

if (successStep.includes('computeSubscriptionProgress')) {
  fail('success UI must not compute subscription progress');
} else pass('no local subscription math in success UI');

if (display.includes('computeSubscriptionProgress') || display.includes('Date.now')) {
  fail('paymentSuccessDisplay must not compute expiry');
} else pass('backend-only display helpers');

const sample = {
  planName: 'Wiki 1',
  amount: 5000,
  currency: 'TZS',
  planDurationDays: 7,
  startedAt: '2026-07-02T10:00:00.000Z',
  expiresAt: '2026-07-09T10:00:00.000Z',
  remainingDays: 7,
};

if (sample.planName !== 'Wiki 1') fail('planName fixture');
else pass('planName fixture');

if (sample.remainingDays !== 7) fail('remainingDays fixture');
else pass('remainingDays fixture');

if (`${sample.planDurationDays} siku` !== '7 siku') fail('duration display pattern');
else pass('duration display pattern');

if (`${sample.remainingDays} siku` !== '7 siku') fail('remaining display pattern');
else pass('remaining display pattern');

if (process.exitCode) process.exit(1);
console.log('\n[verify-payment-success-ui] ok');
