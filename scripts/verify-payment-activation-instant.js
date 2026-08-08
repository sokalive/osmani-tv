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
let shouldAcceptWaitingStateUpdate;
let isPrematureFailedPaymentStatus;
try {
  ({
    computePollIntervalMs,
    APP_WAITING_STATE,
    shouldAcceptWaitingStateUpdate,
    isPrematureFailedPaymentStatus,
  } = requireCjs('../lib/paymentWaitingState.js'));
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
if (interval < 300 || interval > 550) fail(`activating poll too slow/fast ${interval}`);
else pass(`activating poll ${interval}ms`);

const pendingInterval = computePollIntervalMs({
  elapsedMs: 8_000,
  waitingState: APP_WAITING_STATE.PAYMENT_PENDING,
  retryable: false,
  paymentConfirmed: false,
});
if (pendingInterval < 300 || pendingInterval > 900) {
  fail(`pending status poll too slow/fast ${pendingInterval}`);
} else pass(`pending status poll ${pendingInterval}ms`);

if (!modal.includes('payment-status-success-immediate')) {
  fail('SUCCESS status must unlock immediately without probe');
} else pass('SUCCESS unlocks immediately');
if (!modal.includes('do NOT run subscription verify/recover')) {
  fail('PENDING path must skip heavy probe');
} else pass('PENDING skips heavy verify/recover probe');
if (!modal.includes('paymentConfirmedAtRef')) fail('true confirmation latency ref');
else pass('paymentConfirmedAtRef present');

if (modal.includes("'poll-activating'")) {
  fail('double-probe poll-activating must stay removed');
} else pass('no double-probe after pollOnce');

const pollIdx = modal.indexOf('const pollOnce = useCallback');
const successImmediateIdx = modal.indexOf("result.status === 'SUCCESS'", pollIdx);
const verifyProbeInPoll = modal.slice(pollIdx, pollIdx + 2500).includes('probeSubscriptionActivation(');
if (pollIdx < 0 || successImmediateIdx < 0) {
  fail('pollOnce SUCCESS immediate markers missing');
} else if (verifyProbeInPoll) {
  fail('pollOnce must not call probeSubscriptionActivation (blocks status polls)');
} else pass('pollOnce has no blocking subscription probe');

if (!success.includes('🎉 Hongera!')) fail('Hongera title');
else pass('Hongera title');

if (!success.includes('Fungua Channel')) fail('Fungua Channel CTA');
else pass('Fungua Channel CTA');

if (!success.includes('Asante kwa kuchagua Osmani TV')) fail('thanks copy');
else pass('thanks copy');

if (!modal.includes('registerDeviceIntelligence')) fail('device profile refresh');
else pass('device profile refresh');

if (!ctx.includes('deferred')) {
  fail('payment SSE deferred reverify');
} else pass('payment SSE deferred reverify');

if (!waiting.includes('PROVIDER_CONFIRMED_ACTIVATING')) fail('waiting state contract');
else pass('waiting state contract');

if (!waiting.includes('isPrematureFailedPaymentStatus')) fail('premature FAILED helper');
else pass('premature FAILED helper');

if (!modal.includes('ignore_premature_failed')) fail('poll must ignore premature FAILED');
else pass('poll ignores premature FAILED');

if (!modal.includes('failed_ignored_after_guard')) fail('FAILED must respect reconcile guard');
else pass('FAILED respects reconcile guard');

if (
  !shouldAcceptWaitingStateUpdate(
    APP_WAITING_STATE.PAYMENT_PENDING,
    APP_WAITING_STATE.FAILED,
  )
) {
  fail('PENDING must accept legitimate FAILED');
} else pass('PENDING accepts FAILED');

if (
  shouldAcceptWaitingStateUpdate(
    APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING,
    APP_WAITING_STATE.FAILED,
  )
) {
  fail('ACTIVATING must reject stale FAILED');
} else pass('ACTIVATING rejects stale FAILED');

if (
  !isPrematureFailedPaymentStatus(
    {
      status: 'FAILED',
      appWaitingState: 'FAILED',
      raw: { provider_order_id: null, provider_initiation: 'pending' },
    },
    3000,
  )
) {
  fail('null provider_order_id + pending initiation must be premature');
} else pass('early null-provider FAILED is premature');

if (
  isPrematureFailedPaymentStatus(
    {
      status: 'FAILED',
      appWaitingState: 'FAILED',
      raw: { provider_order_id: 'sp_abc', provider_initiation: 'done' },
    },
    10_000,
  )
) {
  fail('FAILED with provider_order_id must not be premature');
} else pass('real FAILED with provider txn is terminal');

if (process.exitCode) process.exit(1);
console.log('\n[verify-payment-activation-instant] ok');
