#!/usr/bin/env node
'use strict';

/**
 * SonicPesa-safe checkout: no silent ZenoPay fallback; order_id gates waiting UI;
 * confirmed payment unlocks immediately.
 * Run: node scripts/verify-sonicpesa-checkout-safe.js
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

function assert(cond, msg) {
  if (!cond) fail(msg);
  else pass(msg);
}

const modal = read('components/PremiumModal.js');
const waiting = read('components/PaymentWaitingStep.js');
const payment = read('api/payment.js');
const cache = read('lib/checkoutProviderCache.js');
const checkout = read('lib/checkoutPaymentProviders.js');

// --- Unit helpers mirrored from app ---
function normalizeCheckoutProvider(raw) {
  const p = String(raw ?? 'zenopay')
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, '');
  if (p === 'sonicpesa' || p === 'sonic') return 'sonicpesa';
  if (p === 'auraxpay' || p === 'aurax') return 'auraxpay';
  return 'zenopay';
}

function isCheckoutGatewayEnabled(id, cfg) {
  if (id === 'zenopay') return cfg.zenopay !== false;
  if (id === 'sonicpesa') return cfg.sonicpesa === true;
  return cfg.auraxpay === true;
}

function resolveActiveCheckoutProvider(cfg) {
  const preferred = normalizeCheckoutProvider(cfg?.payment_provider);
  if (isCheckoutGatewayEnabled(preferred, cfg)) return preferred;
  for (const id of ['sonicpesa', 'zenopay', 'auraxpay']) {
    if (isCheckoutGatewayEnabled(id, cfg)) return id;
  }
  return 'zenopay';
}

function parseCheckoutProvidersResponse(body) {
  const flags = {
    zenopay: body?.zenopay !== false,
    sonicpesa: Boolean(body?.sonicpesa),
    auraxpay: Boolean(body?.auraxpay || body?.aurax),
  };
  return {
    payment_provider: resolveActiveCheckoutProvider({
      payment_provider: normalizeCheckoutProvider(body?.payment_provider),
      ...flags,
    }),
    ...flags,
  };
}

function coerceVerifiedCheckoutProvider(raw) {
  const p = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, '');
  if (p === 'sonicpesa' || p === 'sonic') return 'sonicpesa';
  if (p === 'auraxpay' || p === 'aurax') return 'auraxpay';
  if (p === 'zenopay' || p === 'zeno') return 'zenopay';
  return null;
}

function resolveCheckoutStartPaymentName(provider) {
  if (provider === 'sonicpesa') return 'createSonicpesaOrder';
  if (provider === 'auraxpay') return 'createAuraxpayOrder';
  if (provider === 'zenopay') return 'createPayment';
  return null;
}

// 1) checkout-provider returns SonicPesa → App selects SonicPesa
const live = parseCheckoutProvidersResponse({
  ok: true,
  payment_provider: 'sonicpesa',
  zenopay: true,
  sonicpesa: true,
  auraxpay: false,
});
assert(live.payment_provider === 'sonicpesa', '1. checkout-providers sonicpesa → select SonicPesa');

// 2) checkout-provider timeout → do NOT invent ZenoPay
assert(coerceVerifiedCheckoutProvider(null) === null, '2a. unresolved provider is null (not zenopay)');
assert(coerceVerifiedCheckoutProvider('') === null, '2b. empty provider is null');
assert(modal.includes("useState(null)"), '2c. checkoutProvider initial state is null');
assert(modal.includes('checkout_provider_load_failed'), '2d. load failure logged');
assert(modal.includes('verified_cache'), '2e. may use verified cache only');
assert(modal.includes('CHECKOUT_PROVIDER_UNAVAILABLE'), '2f. Lipia blocked with retry when unresolved');
assert(modal.includes("setCheckoutProvider(null)"), '2g. failure clears provider (no zenopay invent)');
assert(!modal.includes("useState('zenopay')"), '2h. no default useState zenopay');

// Resolver must not silently route unknown → zenopay
assert(
  payment.includes("backendReason: 'checkout_provider_unresolved'") ||
    payment.includes('checkout_provider_unresolved'),
  '2i. resolveCheckoutStartPayment rejects unresolved provider',
);
assert(resolveCheckoutStartPaymentName(null) === null, '2j. null provider has no create-order route');
assert(resolveCheckoutStartPaymentName('sonicpesa') === 'createSonicpesaOrder', '2k. sonicpesa route');

// 3) create-order success with order_id → waiting
assert(modal.includes('setStep(3)'), '3a. waiting step exists');
const payIdx = modal.indexOf('const handleStep2Pay');
const setStep3Idx = modal.indexOf('setStep(3)', payIdx);
const orderGateIdx = modal.indexOf('Missing order_id from server', payIdx);
assert(payIdx > 0 && setStep3Idx > payIdx, '3b. handleStep2Pay sets step 3');
assert(orderGateIdx > 0 && orderGateIdx < setStep3Idx, '3c. order_id validated before setStep(3)');

// 4) create-order fail/timeout → no fake pending
assert(modal.includes('create_order_timeout_blocked'), '4a. timeout is blocked/error');
assert(!modal.includes('create_order_timeout_recovery'), '4b. no timeout-recovery loop');
assert(!modal.includes('create-order-timeout-recovery'), '4c. no orphan recovery source');
assert(modal.includes('CREATE_ORDER_TIMEOUT_MESSAGE'), '4d. timeout shows truthful error');
assert(modal.includes("setStep(5)"), '4e. failure goes to error step');

// 5) Backend confirms → immediate unlock + Hongera
assert(modal.includes('finalizePaymentSuccess'), '5a. finalizePaymentSuccess');
assert(modal.includes('unlockChannels(forUnlock)'), '5b. unlockChannels on confirm');
assert(modal.includes('confirmation_to_unlock_ms'), '5c. measures confirmation→unlock latency');
assert(modal.includes("setStep(4)"), '5d. Hongera success step');
assert(
  modal.indexOf('unlockChannels(forUnlock)') < modal.indexOf("setStep(4)"),
  '5e. unlock before Hongera step',
);

// 6) Not confirmed → no unlock/Hongera via optimistic timeout path
assert(!modal.includes('CREATE_ORDER_ORPHAN_WAIT_SEC'), '6a. orphan wait removed');
assert(
  modal.includes('if (!visible || step !== 3 || !orderId || doneRef.current)'),
  '6b. poll requires real orderId',
);

// 7) Anti-stacking intact
assert(modal.includes('showPaymentEntryDialog'), '7a. payment entry gate dialog');
assert(modal.includes("classification === 'active'"), '7b. active subscription blocks Lipia');
assert(modal.includes('DeviceSubscriptionConflictError'), '7c. device conflict guard');

// UI truthfulness
assert(waiting.includes("name: 'Malipo'"), 'waiting UI does not invent ZenoPay meta');
assert(!waiting.includes('?? CHECKOUT_GATEWAY_META.zenopay'), 'waiting badge no zenopay fallback');
assert(cache.includes('CHECKOUT_PROVIDER_CACHE_KEY'), 'verified provider cache module');
assert(checkout.includes('sonicpesa'), 'checkout provider meta includes SonicPesa');
assert(modal.includes("CHECKOUT_GATEWAY_META[checkoutProvider].name"), 'step2 shows active provider badge');

if (process.exitCode) process.exit(1);
console.log('\n[verify-sonicpesa-checkout-safe] ok');
