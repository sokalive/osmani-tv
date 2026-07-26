#!/usr/bin/env node
'use strict';

/**
 * Regression: payment entitlement must unlock before slow subscription probes.
 * Run: node scripts/verify-payment-activation-instant.js
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const root = path.join(__dirname, '..');
const requireCjs = createRequire(__filename);

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
const activation = read('lib/paymentActivation.js');
const waiting = read('lib/paymentWaitingState.js');
const success = read('components/PaymentSuccessStep.js');
const ctx = read('context/OsmaniAppContext.jsx');

// paymentWaitingState is CJS-compatible (no import) when required via createRequire from .js that uses exports.
let computePollIntervalMs;
let APP_WAITING_STATE;
try {
  ({ computePollIntervalMs, APP_WAITING_STATE } = requireCjs('../lib/paymentWaitingState.js'));
} catch (e) {
  fail(`paymentWaitingState require: ${e.message}`);
}

// Inline entitlement confirm (mirrors lib/paymentActivation.js — avoid ESM require).
function isPaymentEntitlementConfirmed(statusResult) {
  if (!statusResult || typeof statusResult !== 'object') return false;
  if (statusResult.entitlementActive === true) return true;
  const w = String(statusResult.appWaitingState ?? '').trim();
  if (w === 'ACTIVE') return true;
  const activationState = String(statusResult.activationState ?? '').trim().toUpperCase();
  return activationState === 'ACTIVATED' || activationState === 'ALREADY_APPLIED';
}

if (
  !isPaymentEntitlementConfirmed({
    entitlementActive: true,
    appWaitingState: 'PROVIDER_CONFIRMED_ACTIVATING',
  })
) {
  fail('entitlementActive must confirm');
} else pass('entitlementActive confirms');

if (
  !isPaymentEntitlementConfirmed({
    entitlementActive: false,
    appWaitingState: 'ACTIVE',
  })
) {
  fail('ACTIVE waiting state must confirm');
} else pass('ACTIVE waiting confirms');

if (
  isPaymentEntitlementConfirmed({
    status: 'SUCCESS',
    appWaitingState: 'PROVIDER_CONFIRMED_ACTIVATING',
    entitlementActive: false,
  })
) {
  fail('SUCCESS alone must not unlock without entitlement flags');
} else pass('SUCCESS alone does not unlock');

if (!activation.includes('export function isPaymentEntitlementConfirmed')) {
  fail('activation exports entitlement confirm');
} else pass('activation exports entitlement confirm');

if (!activation.includes('probeSubscriptionStatusParallel')) {
  fail('parallel status probe export');
} else pass('parallel status probe export');

if (!activation.includes('Promise.all')) fail('parallel Promise.all');
else pass('parallel Promise.all');

if (!activation.includes('light === true') && !activation.includes('opts.light === true')) {
  fail('light probe mode');
} else pass('light probe mode');

const interval = computePollIntervalMs({
  elapsedMs: 10_000,
  waitingState: APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING,
  retryable: false,
  paymentConfirmed: true,
});
if (interval < 500 || interval > 700) fail(`activating poll too slow/fast ${interval}`);
else pass(`activating poll ${interval}ms`);

const pollIdx = modal.indexOf('const pollOnce = useCallback');
const entitlementIdx = modal.indexOf('isPaymentEntitlementConfirmed(result)', pollIdx);
const probeIdx = modal.indexOf('probeSubscriptionActivation(', entitlementIdx);
if (pollIdx < 0 || entitlementIdx < 0 || probeIdx < 0) {
  fail('pollOnce entitlement/probe markers missing');
} else if (entitlementIdx > probeIdx) {
  fail('entitlement confirm must run before probeSubscriptionActivation');
} else pass('entitlement confirm ordered before probe');

if (modal.includes("'poll-activating'")) {
  fail('double-probe poll-activating must stay removed');
} else pass('no double-probe after pollOnce');

if (!success.includes('🎉 Hongera!')) fail('Hongera title');
else pass('Hongera title');

if (!success.includes('Fungua Channel')) fail('Fungua Channel CTA');
else pass('Fungua Channel CTA');

if (!success.includes('Asante kwa kuchagua Osmani TV')) fail('thanks copy');
else pass('thanks copy');

if (!modal.includes('registerDeviceIntelligence')) fail('device profile refresh');
else pass('device profile refresh');

if (!ctx.includes('instantUnlockProtectUntilRef') || !ctx.includes('instant_unlock_grace_preserved')) {
  fail('payment SSE instant-unlock grace (replaces 2.5s deferred reverify)');
} else pass('payment SSE instant-unlock grace');

if (ctx.includes('2500') && ctx.includes('deferred')) {
  fail('legacy 2500ms deferred payment reverify must stay removed');
} else pass('no 2500ms deferred payment reverify');

if (!waiting.includes('PROVIDER_CONFIRMED_ACTIVATING')) fail('waiting state contract');
else pass('waiting state contract');

if (process.exitCode) process.exit(1);
console.log('\n[verify-payment-activation-instant] ok');
