#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE,
  classifyPaymentEntrySubscription,
} = require('../lib/paymentEntryGuard');
const {
  boundAccountRemainingDays,
  formatAccountRemainingDays,
} = require('../lib/accountRemainingDisplay');
const { computeSubscriptionProgress } = require('../lib/subscriptionMath');

assert.strictEqual(classifyPaymentEntrySubscription({ active: true }), 'active');
assert.strictEqual(
  classifyPaymentEntrySubscription({ active: true, transportPreserved: true }),
  'active',
);
assert.strictEqual(
  classifyPaymentEntrySubscription({ active: false, resolveSource: 'transport:timeout' }),
  'unknown',
);
assert.strictEqual(
  classifyPaymentEntrySubscription({ active: false, resolveSource: 'inactive' }),
  'inactive',
);
assert.ok(ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE.includes('Huwezi kulipia tena'));

assert.strictEqual(
  boundAccountRemainingDays({
    remainingMs: 16 * 86400 * 1000,
    remainingDays: 16,
    assignedPlanDurationDays: 7,
  }),
  7,
);
assert.strictEqual(formatAccountRemainingDays(7), 'Siku 7 Zimebaki');
assert.strictEqual(formatAccountRemainingDays(1), 'Siku 1 Imebaki');

const purchaseAt = Date.parse('2026-07-25T05:00:00.000Z'); // 08:00 Tanzania
const expiryAt = '2026-07-31T21:00:00.000Z'; // 1 Aug 00:00 Tanzania
assert.strictEqual(
  boundAccountRemainingDays({
    remainingMs: Date.parse(expiryAt) - purchaseAt,
    assignedPlanDurationDays: 7,
  }),
  7,
);

const progress = computeSubscriptionProgress({
  startedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-07-17T00:00:00.000Z',
  planDurationDays: 7,
  remainingSeconds: 16 * 86400,
  serverTime: '2026-07-01T00:00:00.000Z',
  serverTimeFetchedAt: Date.parse('2026-07-01T00:00:00.000Z'),
  nowMsOverride: Date.parse('2026-07-01T00:00:00.000Z'),
});
assert.strictEqual(progress.remainingDays, 7);
assert.strictEqual(progress.percentRemaining, 100);

const modal = fs.readFileSync(path.join(root, 'components', 'PremiumModal.js'), 'utf8');
const payment = fs.readFileSync(path.join(root, 'api', 'payment.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'screens', 'AkauntiYanguScreen.js'), 'utf8');
assert.ok(modal.includes("refreshSubscription('payment-entry-gate')"));
assert.ok(modal.includes("refreshSubscription('payment-submit-gate')"));
assert.ok(modal.includes("paymentEntryGate === 'allowed' && step === 1"));
assert.ok(modal.includes('payment_submit_gate_soft_allow'));
assert.ok(modal.includes("paymentGateClassification === 'active'"));
assert.ok(payment.includes('install_instance_id'));
assert.ok(payment.includes('stable_hardware_id'));
assert.ok(payment.includes('identity_candidates'));
assert.ok(account.includes('resolveAssignedPlanDurationDays'));
assert.ok(account.includes('resolveAccountRemainingDays'));

console.log('[verify-production-subscription-policy] ok');
