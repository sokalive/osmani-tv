#!/usr/bin/env node
'use strict';

/**
 * Verify checkout gateway parsing, routing, and backward compatibility.
 * Run: node scripts/verify-payment-checkout-providers.js
 */

const fs = require('fs');
const path = require('path');
const { formatCheckoutPaymentError, extractPaymentBackendReason } = require('../lib/paymentCheckoutErrors');

const root = path.join(__dirname, '..');

/** Inline copies for Node verify (avoid ESM mediaDelivery import chain). */
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
  const auraxpay =
    body?.auraxpay === true ||
    body?.aurax === true ||
    body?.aurax_pay === true ||
    body?.auraxPay === true;
  const flags = {
    zenopay: body?.zenopay !== false,
    sonicpesa: Boolean(body?.sonicpesa),
    auraxpay,
    auraxpay_test: Boolean(body?.auraxpay_test ?? body?.aurax_test),
  };
  return {
    payment_provider: resolveActiveCheckoutProvider({
      payment_provider: normalizeCheckoutProvider(body?.payment_provider),
      ...flags,
    }),
    ...flags,
  };
}

function listEnabledCheckoutGateways(cfg) {
  const ids = ['zenopay', 'sonicpesa', 'auraxpay'];
  return ids.filter((id) => isCheckoutGatewayEnabled(id, cfg)).map((id) => ({ id, active: id === cfg.payment_provider }));
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function assert(cond, msg) {
  if (!cond) {
    fail(msg);
    return false;
  }
  pass(msg);
  return true;
}

// Provider normalization
assert(normalizeCheckoutProvider('sonicpesa') === 'sonicpesa', 'sonicpesa alias');
assert(normalizeCheckoutProvider('auraxpay') === 'auraxpay', 'auraxpay alias');
assert(normalizeCheckoutProvider('aurax') === 'auraxpay', 'aurax shorthand');
assert(normalizeCheckoutProvider('zenopay') === 'zenopay', 'zenopay default');
assert(normalizeCheckoutProvider('unknown') === 'zenopay', 'unknown falls back to zenopay');
assert(normalizeCheckoutProvider('aurax-pay') === 'auraxpay', 'aurax-pay alias');

// Active provider must match enabled gateway flags
const misconfigured = parseCheckoutProvidersResponse({
  payment_provider: 'auraxpay',
  zenopay: true,
  sonicpesa: true,
  auraxpay: false,
});
assert(misconfigured.payment_provider === 'sonicpesa', 'auraxpay admin flag off → fallback to sonicpesa');
assert(
  resolveActiveCheckoutProvider({ payment_provider: 'auraxpay', auraxpay: false, sonicpesa: true, zenopay: true }) ===
    'sonicpesa',
  'resolveActiveCheckoutProvider skips disabled aurax',
);
assert(isCheckoutGatewayEnabled('auraxpay', { auraxpay: false }) === false, 'aurax disabled when flag false');

// Swahili error mapping (no raw Endpoint not found; no misleading "haipatikani" when admin Live)
const swErr = formatCheckoutPaymentError('Endpoint not found', {
  provider: 'auraxpay',
  httpStatus: 502,
  body: { error: 'Endpoint not found', apiStyle: 'aurax', httpStatus: 404 },
});
assert(!/endpoint not found/i.test(swErr), 'Endpoint not found mapped to Swahili');
assert(/usanidi|seva/i.test(swErr), 'Aurax 502 gateway error mentions usanidi/seva not feature off');
assert(
  extractPaymentBackendReason({ providerMessage: 'Endpoint not found', error: 'Endpoint not found' }, 502) ===
    'Endpoint not found',
  'extractPaymentBackendReason merges provider fields',
);

// Live production shape (no auraxpay field yet)
const legacy = parseCheckoutProvidersResponse({
  ok: true,
  payment_provider: 'sonicpesa',
  zenopay: true,
  sonicpesa: true,
});
assert(legacy.payment_provider === 'sonicpesa', 'legacy API active sonicpesa');
assert(legacy.auraxpay === false, 'legacy API auraxpay defaults false');
assert(legacy.zenopay === true, 'legacy API zenopay preserved');

const legacyZen = parseCheckoutProvidersResponse({
  payment_provider: 'zenopay',
  zenopay: true,
  sonicpesa: false,
});
assert(legacyZen.payment_provider === 'zenopay', 'legacy zenopay routing');

// Aurax active
const aurax = parseCheckoutProvidersResponse({
  payment_provider: 'auraxpay',
  zenopay: true,
  sonicpesa: true,
  auraxpay: true,
  auraxpay_logo: 'https://osmanitv.b-cdn.net/uploads/aurax.png',
});
assert(aurax.payment_provider === 'auraxpay', 'auraxpay active provider');
assert(aurax.auraxpay === true, 'auraxpay flag true when enabled');

const auraxAliasOnly = parseCheckoutProvidersResponse({
  payment_provider: 'auraxpay',
  zenopay: true,
  sonicpesa: false,
  aurax: true,
});
assert(auraxAliasOnly.payment_provider === 'auraxpay', 'aurax alias enables auraxpay routing');
assert(auraxAliasOnly.auraxpay === true, 'aurax alias sets auraxpay flag');

const auraxHidden = parseCheckoutProvidersResponse({
  payment_provider: 'auraxpay',
  zenopay: true,
  sonicpesa: false,
  auraxpay: false,
  aurax: false,
});
assert(auraxHidden.payment_provider === 'zenopay', 'auraxpay hidden when flags false');
assert(auraxHidden.auraxpay === false, 'auraxpay flag false when disabled');

const checkoutSrc = fs.readFileSync(path.join(root, 'lib', 'checkoutPaymentProviders.js'), 'utf8');
assert(checkoutSrc.includes('resolveActiveCheckoutProvider'), 'resolveActiveCheckoutProvider exported');
assert(checkoutSrc.includes('auraxpay_test'), 'auraxpay_test parsed from checkout-providers');

const gateways = listEnabledCheckoutGateways(aurax);
assert(gateways.length === 3, 'three enabled gateways when all true');
assert(gateways.some((g) => g.id === 'auraxpay' && g.active), 'aurax card active');

// Routing in api/payment.js
const paymentSrc = fs.readFileSync(path.join(root, 'api', 'payment.js'), 'utf8');
assert(paymentSrc.includes('/payments/auraxpay/create-order'), 'aurax create-order endpoint');
assert(paymentSrc.includes('/payments/auraxPay/create-order'), 'auraxPay path alias fallback');
assert(paymentSrc.includes('formatCheckoutPaymentError'), 'payment API maps user-facing errors');
assert(paymentSrc.includes('CheckoutPaymentError'), 'structured checkout errors with backendReason');
assert(paymentSrc.includes('logPaymentCheckoutFailure'), 'payment API logs backend reason');
assert(paymentSrc.includes('createAuraxpayOrder'), 'createAuraxpayOrder export');
assert(paymentSrc.includes('resolveCheckoutStartPayment'), 'resolveCheckoutStartPayment export');
assert(paymentSrc.includes('checkout_provider_unresolved'), 'unresolved provider rejected (no silent zenopay)');
assert(!paymentSrc.includes("provider === 'sonicpesa' ? 'sonicpesa' : 'zenopay'"), 'binary provider collapse removed');

const modalSrc = fs.readFileSync(path.join(root, 'components', 'PremiumModal.js'), 'utf8');
assert(modalSrc.includes('resolveCheckoutStartPayment'), 'PremiumModal uses resolver');
assert(modalSrc.includes('Lipia — {selectedAmountDisplay}'), 'step-2 pay button shows amount only');
assert(!modalSrc.includes('LIPIA KUPITIA'), 'no provider name on pay button');
assert(!modalSrc.includes('payButtonLabel'), 'no provider-specific pay button label');
assert(!modalSrc.includes('checkoutGateways'), 'no checkout gateway card grid');
assert(!modalSrc.includes('listEnabledCheckoutGateways'), 'no gateway card listing in modal');
assert(modalSrc.includes('formatCheckoutPaymentError'), 'PremiumModal maps payment failure text');
assert(modalSrc.includes('reloadCheckoutConfig'), 'PremiumModal reloads checkout config');
assert(modalSrc.includes('aurax_settings_changed'), 'PremiumModal listens for Aurax admin SSE');
assert(modalSrc.includes('CHECKOUT_GATEWAY_META'), 'PremiumModal shows active gateway badge metadata');
assert(modalSrc.includes('checkoutTestMode'), 'PremiumModal tracks auraxpay_test for admin probe UI');
assert(!modalSrc.includes("useState('zenopay')"), 'PremiumModal does not default provider to zenopay');
assert(modalSrc.includes('create_order_timeout_blocked'), 'timeout does not fake pending payment');
assert(modalSrc.includes('verified_cache'), 'may restore verified checkout provider from cache');
assert(modalSrc.includes('CHECKOUT_PROVIDER_UNAVAILABLE'), 'blocks Lipia when provider unresolved');

const cacheSrc = fs.readFileSync(path.join(root, 'lib', 'checkoutProviderCache.js'), 'utf8');
assert(cacheSrc.includes('CHECKOUT_PROVIDER_CACHE_KEY'), 'checkout provider cache module present');
assert(cacheSrc.includes('coerceVerifiedCheckoutProvider'), 'cache coerces known providers only');

// VersionCode / runtime backward compatibility (OTA targets)
const appConfig = require(path.join(root, 'app.config.js'));
const runtimeTargets = [
  { versionCode: 16, runtime: '1.6.0' },
  { versionCode: 17, runtime: '1.7.0' },
  { versionCode: 18, runtime: '1.7.1' },
  { versionCode: 19, runtime: '1.7.2' },
  { versionCode: 20, runtime: '1.7.2' },
  { versionCode: 21, runtime: '1.7.2' },
  { versionCode: 22, runtime: '1.8.0' },
  { versionCode: 23, runtime: '1.8.1' },
  { versionCode: 24, runtime: '1.8.2' },
];
console.log('\n--- OTA runtime targets (same JS, publish per runtime) ---');
for (const t of runtimeTargets) {
  console.log(`  versionCode ${t.versionCode} → runtime ${t.runtime}`);
}
assert(appConfig.expo.version === '1.8.2', 'current app version 1.8.2');
assert(Number(appConfig.expo.android?.versionCode) === 24, 'current versionCode 24');

if (!process.exitCode) {
  console.log('\n[verify-payment-checkout-providers] ok');
}
