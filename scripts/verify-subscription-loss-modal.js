#!/usr/bin/env node
'use strict';

/**
 * Subscription lifecycle modal guards — revoked/suspended must be explicit.
 * Run: node scripts/verify-subscription-loss-modal.js
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

function pickFromVerifyObject(verifyResult, keys) {
  if (!verifyResult || typeof verifyResult !== 'object') return null;
  for (const key of keys) {
    const direct = verifyResult[key];
    if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  }
  const raw = verifyResult.raw;
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : null;
  const sub = raw.subscription && typeof raw.subscription === 'object' ? raw.subscription : null;
  for (const key of keys) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const candidates = [raw[key], raw[snake], data?.[key], data?.[snake], sub?.[key], sub?.[snake]];
    for (const c of candidates) {
      if (c != null && String(c).trim() !== '') return String(c).trim();
    }
  }
  return null;
}

function extractExplicitInactiveReason(verifyResult) {
  return pickFromVerifyObject(verifyResult, ['inactiveReason', 'inactive_reason']);
}

function extractExplicitInactiveStatus(verifyResult) {
  return pickFromVerifyObject(verifyResult, ['status']);
}

function isExplicitRevokedConfirmation(verifyResult) {
  const reason = String(extractExplicitInactiveReason(verifyResult) ?? '').toLowerCase();
  const status = String(extractExplicitInactiveStatus(verifyResult) ?? '').toLowerCase();
  return reason === 'revoked' || status === 'revoked';
}

function isExplicitSuspendedConfirmation(verifyResult) {
  const reason = String(extractExplicitInactiveReason(verifyResult) ?? '').toLowerCase();
  const status = String(extractExplicitInactiveStatus(verifyResult) ?? '').toLowerCase();
  return reason === 'suspended' || status === 'suspended';
}

function resolveSubscriptionLossModalReason(verifyResult) {
  if (!isConfirmedSubscriptionLoss(verifyResult)) return null;
  if (isExplicitRevokedConfirmation(verifyResult)) return 'revoked';
  if (isExplicitSuspendedConfirmation(verifyResult)) return 'suspended';
  return 'expired';
}

const guard = read('lib/subscriptionSseGuard.js');
const ctx = read('context/OsmaniAppContext.jsx');
const modal = read('components/TransferredAwayModal.js');

if (!guard.includes('isExplicitRevokedConfirmation')) {
  fail('guard must export isExplicitRevokedConfirmation');
} else pass('explicit revoked confirmation export');

if (!guard.includes('isExplicitSuspendedConfirmation')) {
  fail('guard must export isExplicitSuspendedConfirmation');
} else pass('explicit suspended confirmation export');

if (!guard.includes('logSubscriptionLossModalDecision')) {
  fail('diagnostic logging helper required');
} else pass('diagnostic logging helper');

if (!ctx.includes('logSubscriptionLossModalDecision')) {
  fail('context must log modal decisions');
} else pass('context logs modal decisions');

if (!ctx.includes('hadSubscriptionBefore')) {
  fail('gateForPlayback must capture subscription state before verify');
} else pass('gateForPlayback pre-verify snapshot');

if (guard.includes("t.includes('admin')")) {
  fail('revoked guard must not use substring admin match');
} else pass('no substring admin revoked match');

if (!modal.includes("reason === 'suspended'")) {
  fail('TransferredAwayModal must handle suspended reason');
} else pass('suspended modal copy present');

// --- scenario simulations ---
const activeUser = { active: true, resolveSource: 'verify:primary', inactiveReason: null };
if (resolveSubscriptionLossModalReason(activeUser) !== null) {
  fail('sim: active user must not open loss modal');
} else pass('sim: active user — no modal');

const expiredUser = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: 'expired',
};
if (resolveSubscriptionLossModalReason(expiredUser) !== 'expired') {
  fail('sim: expired user must open expired modal');
} else pass('sim: expired user — expired modal');

const revokedUser = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: 'revoked',
};
if (!isExplicitRevokedConfirmation(revokedUser)) fail('sim: revoked inactiveReason');
else pass('sim: revoked inactiveReason confirmed');
if (resolveSubscriptionLossModalReason(revokedUser) !== 'revoked') {
  fail('sim: revoked user must open revoked modal');
} else pass('sim: revoked user — revoked modal');

const revokedByStatus = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: null,
  raw: { status: 'revoked' },
};
if (!isExplicitRevokedConfirmation(revokedByStatus)) fail('sim: revoked status');
else pass('sim: revoked status confirmed');
if (resolveSubscriptionLossModalReason(revokedByStatus) !== 'revoked') {
  fail('sim: status=revoked must open revoked modal');
} else pass('sim: status=revoked — revoked modal');

const suspendedUser = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: 'suspended',
};
if (resolveSubscriptionLossModalReason(suspendedUser) !== 'suspended') {
  fail('sim: suspended user must open suspended modal');
} else pass('sim: suspended user — suspended modal');

const http502 = { active: false, error: 'HTTP 502', resolveSource: 'transport:http' };
if (isConfirmedSubscriptionLoss(http502)) fail('sim: 502 must not be confirmed loss');
else pass('sim: HTTP 502 — not confirmed loss');
if (resolveSubscriptionLossModalReason(http502) !== null) {
  fail('sim: HTTP 502 must not open any loss modal');
} else pass('sim: HTTP 502 — no modal');

const timeout = {
  active: false,
  error: 'timeout',
  resolveSource: 'transport:timeout',
};
if (isConfirmedSubscriptionLoss(timeout)) fail('sim: timeout must not be confirmed loss');
else pass('sim: timeout — not confirmed loss');
if (resolveSubscriptionLossModalReason(timeout) !== null) {
  fail('sim: timeout must not open loss modal');
} else pass('sim: timeout — no modal');

const offline = {
  active: false,
  error: 'Network request failed',
  resolveSource: 'transport:primary',
};
if (resolveSubscriptionLossModalReason(offline) !== null) {
  fail('sim: offline must not open loss modal');
} else pass('sim: offline — no modal');

const sseDisconnect = {
  active: false,
  error: 'HTTP 503',
  resolveSource: 'transport:last',
};
if (resolveSubscriptionLossModalReason(sseDisconnect) !== null) {
  fail('sim: SSE disconnect / 503 must not open loss modal');
} else pass('sim: SSE disconnect — no modal');

const cachePreserved = {
  active: true,
  transportPreserved: true,
  error: 'HTTP 502',
  resolveSource: 'transport:primary',
};
if (isConfirmedSubscriptionLoss(cachePreserved)) {
  fail('sim: cache-preserved active must not be loss');
} else pass('sim: cache failure preserve — no loss modal');

const verifyRetryAmbiguous = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: null,
  raw: { code: 'SUBSCRIPTION_REVOKED', reason: 'admin_action' },
};
if (isExplicitRevokedConfirmation(verifyRetryAmbiguous)) {
  fail('sim: code/reason fields must not confirm revoked');
} else pass('sim: ambiguous code/reason — not revoked');
if (resolveSubscriptionLossModalReason(verifyRetryAmbiguous) !== 'expired') {
  fail('sim: ambiguous inactive must default expired not revoked');
} else pass('sim: verify retry ambiguous — expired modal only');

const falseAdminStatus = {
  active: false,
  resolveSource: 'inactive',
  inactiveReason: null,
  raw: { status: 'inactive', reason: 'admin_updated_plan' },
};
if (isExplicitRevokedConfirmation(falseAdminStatus)) {
  fail('sim: status=inactive must not map to revoked');
} else pass('sim: status=inactive — not revoked');

const preservedActiveAfter502 = {
  active: true,
  transportPreserved: true,
  resolveSource: 'transport:primary',
};
if (resolveSubscriptionLossModalReason(preservedActiveAfter502) !== null) {
  fail('sim: active after transport preserve must never show revoked');
} else pass('sim: active subscription never sees revoked popup');

if (!process.exitCode) {
  console.log('\n[verify-subscription-loss-modal] ok');
}
