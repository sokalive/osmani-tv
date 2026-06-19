#!/usr/bin/env node
'use strict';

/**
 * Verify checkout gateway parsing, routing, and backward compatibility.
 * Run: node scripts/verify-payment-checkout-providers.js
 */

const fs = require('fs');
const path = require('path');
const {
  normalizeCheckoutProvider,
  parseCheckoutProvidersResponse,
  listEnabledCheckoutGateways,
} = require('../lib/checkoutPaymentProviders');

const root = path.join(__dirname, '..');

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
assert(aurax.logos.auraxpay.includes('aurax.png'), 'aurax logo parsed');

const gateways = listEnabledCheckoutGateways(aurax);
assert(gateways.length === 3, 'three enabled gateways when all true');
assert(gateways.some((g) => g.id === 'auraxpay' && g.active), 'aurax card active');

// Routing in api/payment.js
const paymentSrc = fs.readFileSync(path.join(root, 'api', 'payment.js'), 'utf8');
assert(paymentSrc.includes('/payments/auraxpay/create-order'), 'aurax create-order endpoint');
assert(paymentSrc.includes('createAuraxpayOrder'), 'createAuraxpayOrder export');
assert(paymentSrc.includes('resolveCheckoutStartPayment'), 'resolveCheckoutStartPayment export');
assert(!paymentSrc.includes("provider === 'sonicpesa' ? 'sonicpesa' : 'zenopay'"), 'binary provider collapse removed');

const modalSrc = fs.readFileSync(path.join(root, 'components', 'PremiumModal.js'), 'utf8');
assert(modalSrc.includes('resolveCheckoutStartPayment'), 'PremiumModal uses resolver');
assert(modalSrc.includes('Lipia — {selectedAmountDisplay}'), 'step-2 pay button shows amount only');
assert(!modalSrc.includes('LIPIA KUPITIA'), 'no provider name on pay button');
assert(!modalSrc.includes('payButtonLabel'), 'no provider-specific pay button label');
assert(!modalSrc.includes('Njia ya malipo'), 'no visible checkout gateway cards');
assert(!modalSrc.includes('checkoutGateways'), 'no checkout gateway card grid');
assert(!modalSrc.includes('createSonicpesaOrder'), 'PremiumModal no direct sonic import');

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
];
console.log('\n--- OTA runtime targets (same JS, publish per runtime) ---');
for (const t of runtimeTargets) {
  console.log(`  versionCode ${t.versionCode} → runtime ${t.runtime}`);
}
assert(appConfig.expo.version === '1.8.0', 'current app version 1.8.0');
assert(Number(appConfig.expo.android?.versionCode) === 22, 'current versionCode 22');

if (!process.exitCode) {
  console.log('\n[verify-payment-checkout-providers] ok');
}
