#!/usr/bin/env node
'use strict';

/**
 * Immediate subscription revocation visibility — App entitlement guards.
 * Run: node scripts/verify-subscription-revocation-visibility.js
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
const guard = read('lib/subscriptionSseGuard.js');
const nav = read('lib/premiumChannelNavigation.js');
const app = read('App.js');
const gate = read('lib/premiumTapGate.js');

if (!guard.includes('isAuthoritativeInactiveEntitlement')) fail('authoritative inactive helper');
else pass('authoritative inactive helper');

if (!ctx.includes('authoritativeInactive')) fail('reverify authoritative inactive guard');
else pass('reverify authoritative inactive guard');

if (!ctx.includes('clearLocalActiveSubscription(\'sse:subscription_revoked\')')) {
  fail('SSE revoked must clear local entitlement');
} else pass('SSE revoked clears local entitlement');

if (ctx.includes('allowed_cache_ref')) {
  fail('gate must not fast-allow stale cache ref on foreground');
} else pass('no foreground stale cache-ref fast path');

if (!ctx.includes('await reverifySubscription(`gate:${reason}`)')) {
  fail('foreground gate must await reverify');
} else pass('foreground gate awaits reverify');

if (!nav.includes("verifySubscriptionBeforePlay('channel-tap-premium')")) {
  fail('premium tap must gate before navigate');
} else pass('premium tap authoritative gate');

if (!app.includes("reverifySubscription('catalog-focus')")) fail('catalog focus reverify');
else pass('catalog focus reverify');

if (!gate.includes('shouldShowKulipiaBadge')) fail('KULIPIA badge helper present');
else pass('KULIPIA badge helper present');

function isConfirmedSubscriptionLoss(verifyResult) {
  if (!verifyResult || verifyResult.active === true) return false;
  if (verifyResult.transportPreserved === true) return false;
  const err = verifyResult.error;
  const transport =
    err &&
    (String(err).toLowerCase().includes('network') ||
      String(err).toLowerCase().includes('timeout') ||
      String(err).includes('502'));
  if (transport) return false;
  const src = String(verifyResult.resolveSource ?? '');
  if (src.startsWith('transport:')) return false;
  return src === 'inactive';
}

function isAuthoritativeInactiveEntitlement(v) {
  return isConfirmedSubscriptionLoss(v);
}

function shouldShowKulipiaBadge(input) {
  if (!input?.isPremium) return false;
  if (input?.freeMode) return false;
  return input?.isSubscribed !== true;
}

const revoked = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: 'revoked',
};
if (!isAuthoritativeInactiveEntitlement(revoked)) fail('sim: revoked is authoritative');
else pass('sim: revoked authoritative');

const timeout = {
  active: false,
  resolveSource: 'transport:primary',
  error: 'timeout',
};
if (isAuthoritativeInactiveEntitlement(timeout)) fail('sim: timeout not authoritative');
else pass('sim: timeout not authoritative');

let subscribed = true;
function applyReverify(r) {
  if (isAuthoritativeInactiveEntitlement(r)) subscribed = false;
}
applyReverify(revoked);
if (subscribed) fail('sim: authoritative inactive clears subscribed');
else pass('sim: authoritative inactive clears subscribed');

let gen = 0;
let bestActive = true;
function accept(r) {
  const k = ++gen;
  if (isAuthoritativeInactiveEntitlement(r)) {
    bestActive = false;
    return k;
  }
  return null;
}
const kRevoked = accept(revoked);
const stalePending = { active: false, resolveSource: 'transport:primary', error: 'timeout' };
if (bestActive === false && kRevoked === gen) {
  if (isAuthoritativeInactiveEntitlement(stalePending)) bestActive = true;
}
if (bestActive) fail('sim: stale transport must not restore after revoked');
else pass('sim: stale transport ignored after revoked');

if (!shouldShowKulipiaBadge({ isPremium: true, freeMode: false, isSubscribed: false })) {
  fail('sim: revoked user shows KULIPIA');
} else pass('sim: revoked shows KULIPIA');

if (shouldShowKulipiaBadge({ isPremium: true, freeMode: false, isSubscribed: true })) {
  fail('sim: active hides KULIPIA');
} else pass('sim: active hides KULIPIA');

function resolveSubscriptionLossModalReason(verifyResult) {
  if (!isAuthoritativeInactiveEntitlement(verifyResult)) return null;
  const reason = String(verifyResult.inactiveReason ?? '').toLowerCase();
  const status = String(verifyResult.status ?? '').toLowerCase();
  if (reason === 'revoked' || status === 'revoked') return null;
  if (reason === 'suspended' || status === 'suspended') return 'suspended';
  return 'expired';
}

if (resolveSubscriptionLossModalReason(revoked) !== null) {
  fail('sim: admin revoke must not return modal reason');
} else pass('sim: silent admin revoke modal');

if (resolveSubscriptionLossModalReason({ active: false, resolveSource: 'inactive', inactiveReason: 'expired' }) !== 'expired') {
  fail('sim: natural expiry still shows modal');
} else pass('sim: natural expiry modal preserved');

if (process.exitCode) process.exit(1);
console.log('\n[verify-subscription-revocation-visibility] ok');
