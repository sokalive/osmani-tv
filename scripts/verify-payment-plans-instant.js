#!/usr/bin/env node
'use strict';

/**
 * Payment plans instant modal — cache + boot preload (no modal-open network wait).
 * Run: node scripts/verify-payment-plans-instant.js
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

const cache = read('lib/paymentPlansCache.js');
const modal = read('components/PremiumModal.js');
const ctx = read('context/OsmaniAppContext.jsx');

if (!cache.includes('memoryCache')) fail('in-memory payment plans cache');
else pass('in-memory cache');

if (!cache.includes('hydratePaymentPlansCacheFromStorage')) fail('AsyncStorage hydrate');
else pass('AsyncStorage hydrate');

if (!cache.includes('refreshPaymentPlansCache')) fail('background refresh');
else pass('background refresh');

if (!cache.includes('PAYMENT_PLANS_FIRST_SPINNER_MAX_MS = 500')) fail('500ms first-install cap');
else pass('500ms spinner cap');

if (!ctx.includes('hydratePaymentPlansCacheFromStorage')) fail('boot hydrate in context');
else pass('boot preload in OsmaniAppContext');

if (!ctx.includes('refreshPaymentPlansCache')) fail('boot refresh in context');
else pass('boot background refresh');

if (!modal.includes('paymentPlansCache')) fail('PremiumModal must use paymentPlansCache');
else pass('PremiumModal uses cache');

if (modal.includes('setPlans([])')) fail('PremiumModal must not clear plans on modal open');
else pass('no setPlans([]) on open');

if (!modal.includes('getCachedPaymentPlansSync')) fail('sync cache read on modal open');
else pass('sync cache read');

if (!process.exitCode) console.log('\n[verify-payment-plans-instant] ok');
