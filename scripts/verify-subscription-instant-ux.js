#!/usr/bin/env node
'use strict';

/**
 * v1.0.0-style instant subscription UX (SSE apply before verify).
 * Run: node scripts/verify-subscription-instant-ux.js
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

const ctx = read('context/OsmaniAppContext.jsx');
const sse = read('lib/subscriptionSseInstant.js');
const app = read('App.js');
const account = read('screens/AkauntiYanguScreen.js');
const subApi = read('api/subscription.js');

if (!ctx.includes('applyInstantSubscriptionState')) fail('context instant apply');
else pass('context instant apply');

if (!ctx.includes('tryInstantApplyFromSse')) fail('SSE instant hook');
else pass('SSE instant hook');

if (!ctx.includes('tryInstantApplyFromSse(ev, payload)')) fail('subscription SSE calls instant apply first');
else pass('subscription SSE instant-before-verify');

if (!ctx.includes('unlock-channels')) fail('unlockChannels uses instant apply');
else pass('unlockChannels instant details');

if (!sse.includes('parseInstantSubscriptionFromSse')) fail('SSE parse helper');
else pass('SSE parse helper');

if (!subApi.includes('parseSubscriptionPayload')) fail('parseSubscriptionPayload export');
else pass('parseSubscriptionPayload export');

if (!app.includes('SubscriptionActivationSuccessModal')) fail('global activation success modal');
else pass('global activation success modal');

if (!account.includes('showActivationSuccess')) fail('offer code shows activation success');
else pass('offer code activation success');

if (!account.includes("showActivationSuccess(forSuccess, 'offer_code')")) {
  fail('offer code must show Hongera from redeem payload (not blocked verify)');
} else {
  pass('offer code Hongera from redeem success payload');
}

if (/await\s+refreshSubscription\s*\(/.test(account)) {
  fail('offer code must not await refreshSubscription before Home/Hongera');
} else {
  pass('offer code does not await refreshSubscription before success UX');
}

if (!account.includes("refreshSubscription('offer-code-redeem-bg')")) {
  fail('offer code must still reconcile in background after success UX');
} else {
  pass('offer code background reverify after Home/Hongera');
}

if (ctx.includes('payment_success') && ctx.includes("eventName !== 'payment_success'")) {
  pass('payment SSE skips duplicate global success modal');
} else {
  fail('must not duplicate payment success modal on SSE');
}

if (!process.exitCode) {
  console.log('\n[verify-subscription-instant-ux] ok');
}
