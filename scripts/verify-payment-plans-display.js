#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const {
  DEFAULT_FALLBACK_PLANS,
  parsePlansFromRaw,
  mergeWithFallbackPlans,
  formatPlansLoadError,
  resolvePlanPrice,
} = require('../lib/paymentPlansDisplay');

const modal = fs.readFileSync(path.join(root, 'components', 'PremiumModal.js'), 'utf8');
const payment = fs.readFileSync(path.join(root, 'api', 'payment.js'), 'utf8');

if (!DEFAULT_FALLBACK_PLANS.length) fail('DEFAULT_FALLBACK_PLANS empty');
else pass('DEFAULT_FALLBACK_PLANS defined');

const first = DEFAULT_FALLBACK_PLANS[0];
if (!first.id || !first.name || !(first.price > 0)) fail('fallback plan missing id/name/price');
else pass('fallback plan has id, name, price');

const liveShape = [
  { id: 3, name: 'Wiki 1', price: 3000, durationDays: 7, isActive: true },
];
const parsed = parsePlansFromRaw(liveShape);
if (parsed.length !== 1 || parsed[0].price !== 3000) fail('parsePlansFromRaw VPS shape');
else pass('parsePlansFromRaw VPS camelCase');

if (mergeWithFallbackPlans([]).length !== DEFAULT_FALLBACK_PLANS.length) {
  fail('mergeWithFallbackPlans empty input');
} else pass('mergeWithFallbackPlans uses defaults');

if (formatPlansLoadError(new Error('payment-plans')) !== '') {
  fail('formatPlansLoadError hides payment-plans label');
} else pass('formatPlansLoadError hides internal timeout label');

if (resolvePlanPrice(null) <= 0) fail('resolvePlanPrice fallback');
else pass('resolvePlanPrice never zero');

if (!modal.includes('DEFAULT_FALLBACK_PLANS')) fail('PremiumModal uses DEFAULT_FALLBACK_PLANS');
else pass('PremiumModal instant defaults');

if (modal.includes('TSh —')) fail('PremiumModal still has TSh — placeholder');
else pass('no TSh — in PremiumModal');

if (!modal.includes('formatPlansLoadError')) fail('PremiumModal filters plan errors');
else pass('PremiumModal filters plan errors');

if (!payment.includes('PLANS_BACKGROUND_TIMEOUT_MS')) fail('background plans timeout');
else pass('background plans timeout for slow VPS');

console.log('\n[verify-payment-plans-display] ok');
