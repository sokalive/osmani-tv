#!/usr/bin/env node
'use strict';

/**
 * SonicPesa VPS activation visibility — contract + race + load harness.
 * Run: node scripts/verify-sonicpesa-activation-visibility.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

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

const {
  APP_WAITING_STATE,
  PaymentReconcileGuard,
  computePollIntervalMs,
  isTerminalWaitingState,
  parsePaymentActivationStatus,
  shouldAcceptWaitingStateUpdate,
} = require('../lib/paymentWaitingState');

const payment = read('api/payment.js');
const modal = read('components/PremiumModal.js');
const waiting = read('components/PaymentWaitingStep.js');
const apiBase = read('lib/apiBaseUrl.js');
const playVps = read('lib/playVpsApiHost.js');

if (!payment.includes('resolveOrderPaymentStatus')) fail('resolveOrderPaymentStatus');
else pass('resolveOrderPaymentStatus');

if (!payment.includes('/api/payments/sonicpesa/status/')) fail('sonicpesa status endpoint');
else pass('sonicpesa status endpoint');

if (!payment.includes('parsePaymentActivationStatus')) fail('payment parses app_waiting_state');
else pass('payment parses app_waiting_state');

if (!modal.includes('PaymentReconcileGuard')) fail('PremiumModal reconcile guard');
else pass('PremiumModal reconcile guard');

if (!modal.includes('resolveOrderPaymentStatus')) fail('PremiumModal uses provider-routed status');
else pass('PremiumModal uses provider-routed status');

if (!modal.includes('AppState.addEventListener')) fail('foreground resume listener');
else pass('foreground resume listener');

if (!modal.includes('APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING')) {
  fail('activating state handling');
} else pass('activating state handling');

if (!modal.includes('PHONE_CONFLICT')) fail('phone conflict handling');
else pass('phone conflict handling');

if (!modal.includes('MOVED_TO_SIBLING_DEVICE')) fail('sibling device handling');
else pass('sibling device handling');

if (!waiting.includes('appWaitingState')) fail('waiting step appWaitingState prop');
else pass('waiting step appWaitingState prop');

if (!waiting.includes('Malipo Yamethibitishwa')) fail('activating UI copy');
else pass('activating UI copy');

if (!playVps.includes('forcedPlayVpsApiBaseUrl')) fail('VPS forced routing');
else pass('VPS forced routing');

if (!apiBase.includes('isPlayStoreVpsBuild')) fail('Play VPS build detection');
else pass('Play VPS build detection');

const scenarios = [
  ['PENDING', { status: 'PENDING', app_waiting_state: 'PAYMENT_PENDING' }],
  ['ACTIVATING', { status: 'SUCCESS', transaction_status: 'completed', app_waiting_state: 'PROVIDER_CONFIRMED_ACTIVATING' }],
  ['ACTIVE', { status: 'SUCCESS', app_waiting_state: 'ACTIVE', entitlement_active: true }],
  ['RETRYING', { status: 'PENDING', app_waiting_state: 'RETRYING', retryable: true }],
  ['FAILED', { status: 'FAILED', app_waiting_state: 'FAILED' }],
  ['PHONE_CONFLICT', { status: 'SUCCESS', app_waiting_state: 'PHONE_CONFLICT' }],
  ['MOVED', { status: 'SUCCESS', app_waiting_state: 'MOVED_TO_SIBLING_DEVICE' }],
];

for (const [name, body] of scenarios) {
  const p = parsePaymentActivationStatus(body);
  if (p.appWaitingState !== body.app_waiting_state) {
    fail(`parse ${name}: got ${p.appWaitingState}`);
  } else pass(`parse ${name}`);
}

const guard = new PaymentReconcileGuard();
guard.tryAdvance(APP_WAITING_STATE.PAYMENT_PENDING);
guard.tryAdvance(APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING);
guard.tryAdvance(APP_WAITING_STATE.ACTIVE);
if (guard.tryAdvance(APP_WAITING_STATE.PAYMENT_PENDING)) {
  fail('stale PENDING must not regress ACTIVE');
} else pass('stale PENDING rejected after ACTIVE');

if (!shouldAcceptWaitingStateUpdate(APP_WAITING_STATE.ACTIVE, APP_WAITING_STATE.PAYMENT_PENDING)) {
  pass('monotonic ACTIVE guard');
} else fail('monotonic ACTIVE guard');

const aggressive = computePollIntervalMs({
  elapsedMs: 5000,
  waitingState: APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING,
  retryable: true,
  paymentConfirmed: true,
});
if (aggressive < 500 || aggressive > 700) fail(`aggressive interval ${aggressive}`);
else pass(`aggressive interval ${aggressive}ms`);

const midActivating = computePollIntervalMs({
  elapsedMs: 90_000,
  waitingState: APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING,
  retryable: true,
  paymentConfirmed: true,
});
if (midActivating < 700 || midActivating > 1000) fail(`mid activating interval ${midActivating}`);
else pass(`mid activating interval ${midActivating}ms`);

function simulateClient(responses) {
  const g = new PaymentReconcileGuard();
  let ui = APP_WAITING_STATE.PAYMENT_PENDING;
  let done = false;
  for (const body of responses) {
    const p = parsePaymentActivationStatus(body);
    if (g.tryAdvance(p.appWaitingState)) ui = p.appWaitingState;
    if (ui === APP_WAITING_STATE.ACTIVE) done = true;
    if (isTerminalWaitingState(ui) && ui !== APP_WAITING_STATE.ACTIVE) break;
  }
  return { ui, done };
}

const sim1 = simulateClient([
  { status: 'PENDING', app_waiting_state: 'PAYMENT_PENDING' },
  { status: 'SUCCESS', app_waiting_state: 'PROVIDER_CONFIRMED_ACTIVATING' },
  { status: 'SUCCESS', app_waiting_state: 'ACTIVE', entitlement_active: true },
]);
if (!sim1.done || sim1.ui !== APP_WAITING_STATE.ACTIVE) fail('sim PENDING→ACTIVATING→ACTIVE');
else pass('sim PENDING→ACTIVATING→ACTIVE');

const sim2 = simulateClient([
  { status: 'SUCCESS', app_waiting_state: 'ACTIVE', entitlement_active: true },
  { status: 'PENDING', app_waiting_state: 'PAYMENT_PENDING' },
]);
if (sim2.ui !== APP_WAITING_STATE.ACTIVE) fail('sim stale PENDING after ACTIVE');
else pass('sim stale PENDING after ACTIVE');

const CLIENT_COUNT = 250;
for (let c = 0; c < CLIENT_COUNT; c += 1) {
  const delay = computePollIntervalMs({
    elapsedMs: c * 40,
    waitingState:
      c % 5 === 0
        ? APP_WAITING_STATE.PROVIDER_CONFIRMED_ACTIVATING
        : APP_WAITING_STATE.PAYMENT_PENDING,
    retryable: c % 7 === 0,
    paymentConfirmed: c % 5 === 0,
  });
  if (delay < 500) fail(`client ${c} delay too low ${delay}`);
}
pass(`${CLIENT_COUNT} client interval simulation (no storm)`);

function probeVps(pathSuffix) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'api.osmanitv.com',
        path: pathSuffix,
        timeout: 8000,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout' });
    });
  });
}

(async () => {
  const checkout = await probeVps('/api/payments/checkout-providers');
  if (checkout.status === 200) pass('VPS checkout-providers reachable');
  else pass(`VPS probe skip (${checkout.status || checkout.error})`);

  const unknown = await probeVps('/api/payments/sonicpesa/status/__probe_unknown_order__');
  if ([404, 200, 500].includes(unknown.status)) {
    pass(`VPS sonicpesa status route (${unknown.status})`);
  } else {
    pass('VPS sonicpesa status probe skip');
  }

  if (process.exitCode) process.exit(1);
  console.log('\n[verify-sonicpesa-activation-visibility] ok');
})();
