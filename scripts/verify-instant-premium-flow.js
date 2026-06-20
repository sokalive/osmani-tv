#!/usr/bin/env node
'use strict';

/**
 * Static checks: instant premium/payment flow (no multi-minute subscription wait).
 * Run: node scripts/verify-instant-premium-flow.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const context = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'lib', 'premiumChannelNavigation.js'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'components', 'PremiumModal.js'), 'utf8');
const payment = fs.readFileSync(path.join(root, 'api', 'payment.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (!app.includes('const snapshot = getPremiumAccessSnapshot()')) {
  fail('channel navigation must use sync snapshot');
} else pass('sync channel snapshot');

if (app.includes('await awaitPremiumAccessSnapshot()')) {
  fail('App.js must not await premium snapshot before navigation');
} else pass('no blocking await in App.js navigation');

if (!context.includes('premiumPlaybackReady: true')) {
  fail('snapshot must not gate on subscription sync');
} else pass('snapshot never blocks on sync flags');

if (!context.includes('warmPaymentCatalogCache')) {
  fail('payment catalog warm on bootstrap required');
} else pass('payment catalog bootstrap warm');

if (nav.includes('await openPaymentModal()')) {
  fail('unpaid payment modal path must not await openPaymentModal');
} else pass('sync payment modal open');

if (!modal.includes('getPlansCachedFirst')) {
  fail('PremiumModal must load plans cache-first');
} else pass('PremiumModal cache-first plans');

if (!payment.includes('getCheckoutPaymentProvidersCachedFirst')) {
  fail('checkout providers cache-first required');
} else pass('checkout providers cache-first');

if (!payment.includes('CHECKOUT_PROVIDER_TIMEOUT_MS')) {
  fail('checkout provider fetch timeout required');
} else pass('checkout provider timeout');

if (!process.exitCode) {
  console.log('\n[verify-instant-premium-flow] ok');
}
