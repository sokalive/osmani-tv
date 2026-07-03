#!/usr/bin/env node
'use strict';

/**
 * Verify-embedded plans must survive catalog normalization (no is_active field).
 * Run: node scripts/verify-account-display-sparse.js
 */

const fs = require('fs');
const path = require('path');
const { resolveDisplayDurationDays } = require('../lib/subscriptionCanonical');

const root = path.join(__dirname, '..');

function pass(msg) {
  console.log('PASS:', msg);
}
function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

const cacheSrc = fs.readFileSync(path.join(root, 'lib/paymentPlansCache.js'), 'utf8');
if (!cacheSrc.includes('explicitlyInactive')) {
  fail('paymentPlansCache must treat missing is_active as active when plan has id/name');
} else pass('lenient is_active normalization in paymentPlansCache');

const displaySrc = fs.readFileSync(path.join(root, 'lib/accountSubscriptionDisplay.js'), 'utf8');
if (!displaySrc.includes('traceAccountDisplay')) fail('account display trace logging');
else pass('account display trace hook');

const accountSrc = fs.readFileSync(path.join(root, 'screens/AkauntiYanguScreen.js'), 'utf8');
if (!accountSrc.includes('refreshPaymentPlansCache')) {
  fail('Account must refresh payment plans catalog on focus');
} else pass('account focus refreshes plans catalog');

const subSrc = fs.readFileSync(path.join(root, 'api/subscription.js'), 'utf8');
if (!subSrc.includes('pay?.plan_id')) fail('pickPlanId must read payment.plan_id');
else pass('pickPlanId reads payment.plan_id');

function normalizeRowActive(raw) {
  const explicitlyInactive = raw?.is_active === false || raw?.isActive === false;
  const explicitlyActive = raw?.is_active === true || raw?.isActive === true;
  const hasIdentity =
    String(raw?.id ?? raw?.plan_id ?? '').trim() !== '' ||
    String(raw?.name ?? raw?.title ?? '').trim() !== '';
  return explicitlyActive || (!explicitlyInactive && hasIdentity);
}

const verifyPlans = [
  { id: 3, name: 'Wiki 1', price: 3000, duration_days: 7 },
  { id: 4, name: 'MWENZI 1', price: 5000, duration_days: 30 },
];
const activeCount = verifyPlans.filter(normalizeRowActive).length;
if (activeCount !== 2) fail(`verify plans should normalize (${activeCount})`);
else pass('verify-embedded plans active without is_active field');

if (normalizeRowActive({ id: 9, name: 'tex', isActive: false })) {
  fail('explicit inactive must be excluded');
} else pass('explicit inactive excluded');

const sparseTiming = {
  expiresAt: '2026-07-10T12:00:00.000Z',
  remainingSeconds: 7 * 86400,
  planDurationDays: 7,
  planName: 'Wiki 1',
  amount: 3000,
};
const duration = resolveDisplayDurationDays(sparseTiming);
if (duration !== 7) fail(`duration card expected 7, got ${duration}`);
else pass('duration resolves from planDurationDays');

if (!process.exitCode) {
  console.log('\n[verify-account-display-sparse] ok');
}
