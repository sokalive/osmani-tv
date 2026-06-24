#!/usr/bin/env node
'use strict';

/**
 * HTTP 502 / transient outages must not map to suspended subscription or cache clear.
 * Run: node scripts/verify-subscription-502-guard.js
 */

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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// Mirror production helpers (no dynamic import on Windows CI)
function isNetworkTransportError(errorLike) {
  const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('networkerror') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout')
  );
}

function isTransientServerError(errorLike) {
  const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
  return (
    /^http\s*(502|503|504)\b/.test(msg) ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout')
  );
}

function isSubscriptionTransportFailure(result) {
  if (!result?.error) return false;
  return isNetworkTransportError(result.error) || isTransientServerError(result.error);
}

function isConfirmedSubscriptionLoss(verifyResult) {
  if (!verifyResult || verifyResult.active === true) return false;
  if (verifyResult.transportPreserved === true) return false;
  if (isSubscriptionTransportFailure(verifyResult)) return false;
  const src = String(verifyResult.resolveSource ?? '');
  if (src.startsWith('transport:')) return false;
  return src === 'inactive';
}

function isExplicitRevokedInactiveReason(reason) {
  const t = String(reason ?? '').toLowerCase();
  return t === 'revoked';
}

function resolveSubscriptionLossModalReason(verifyResult) {
  if (!isConfirmedSubscriptionLoss(verifyResult)) return null;
  const reason = String(verifyResult.inactiveReason ?? '').toLowerCase();
  const status = String(verifyResult.raw?.status ?? '').toLowerCase();
  if (reason === 'revoked' || status === 'revoked') return 'revoked';
  const suspended =
    reason === 'suspended' || status === 'suspended';
  if (suspended) return 'suspended';
  return 'expired';
}

const sub = read('api/subscription.js');
const guard = read('lib/subscriptionSseGuard.js');
const ctx = read('context/OsmaniAppContext.jsx');
const connectivity = read('lib/catalogConnectivity.js');

if (!sub.includes('isTransientServerError')) fail('subscription must treat 502 as transport');
else pass('subscription imports transient server helper');

if (!guard.includes('resolveSubscriptionLossModalReason')) {
  fail('subscriptionSseGuard must export resolveSubscriptionLossModalReason');
} else pass('loss modal reason resolver');

if (ctx.includes("? inner.reason : 'revoked'")) {
  fail('context must not default SSE reason to revoked');
} else pass('no default revoked SSE reason');

if (!connectivity.includes('Huduma haipatikani kwa sasa')) {
  fail('missing Swahili transient server message');
} else pass('Swahili transient server message');

// --- simulations ---
const http502 = { active: false, error: 'HTTP 502', resolveSource: 'transport:http' };
if (!isSubscriptionTransportFailure(http502)) fail('HTTP 502 must be transport failure');
else pass('sim: HTTP 502 is transport failure');

if (isConfirmedSubscriptionLoss(http502)) {
  fail('sim: HTTP 502 must not be confirmed subscription loss');
} else pass('sim: HTTP 502 not confirmed loss');

if (resolveSubscriptionLossModalReason(http502) !== null) {
  fail('sim: HTTP 502 must not open revoked modal even with SSE hint');
} else pass('sim: HTTP 502 blocks revoked modal');

const trueRevoked = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: 'revoked',
};
if (!isConfirmedSubscriptionLoss(trueRevoked)) fail('sim: real revoked must be confirmed loss');
else pass('sim: real revoked is confirmed loss');

if (resolveSubscriptionLossModalReason(trueRevoked) !== 'revoked') {
  fail('sim: explicit revoked reason must map to revoked modal');
} else pass('sim: explicit revoked maps to revoked modal');

const ambiguousInactive = { active: false, resolveSource: 'inactive', inactiveReason: null };
if (resolveSubscriptionLossModalReason(ambiguousInactive) !== 'expired') {
  fail('sim: ambiguous inactive must default expired not revoked');
} else pass('sim: ambiguous inactive defaults expired');

const falseCodeRevoked = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: null,
  raw: { code: 'SUBSCRIPTION_REVOKED' },
};
if (resolveSubscriptionLossModalReason(falseCodeRevoked) !== 'expired') {
  fail('sim: code field alone must not open revoked modal');
} else pass('sim: code-only hint defaults expired');

const preserved = {
  active: true,
  transportPreserved: true,
  error: 'HTTP 502',
  resolveSource: 'transport:primary',
};
if (isConfirmedSubscriptionLoss(preserved)) {
  fail('sim: transport preserved active must not be loss');
} else pass('sim: transport preserved cache not loss');

if (!process.exitCode) {
  console.log('\n[verify-subscription-502-guard] ok');
}
