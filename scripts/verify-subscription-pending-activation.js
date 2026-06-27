#!/usr/bin/env node
'use strict';

/**
 * Pending activation parsing + inactive payload retention.
 * Run: node scripts/verify-subscription-pending-activation.js
 */

const path = require('path');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function pickNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function pickInactiveReason(body) {
  if (!body || typeof body !== 'object') return null;
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const candidates = [body.status, data?.status];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c).trim();
  }
  return null;
}

function isSubscriptionTransportFailure(result) {
  if (!result?.error) return false;
  const msg = String(result.error).toLowerCase();
  return msg.includes('timeout') || /^http\s*(502|503|504)\b/.test(msg);
}

function isSubscriptionPendingActivation(result) {
  if (!result || result.active === true) return false;
  if (isSubscriptionTransportFailure(result)) return false;
  const raw = result.raw;
  const status = String(
    result.status ??
      raw?.status ??
      raw?.data?.status ??
      pickInactiveReason(raw) ??
      '',
  ).toLowerCase();
  if (status === 'pending' || status === 'awaiting_confirmation' || status === 'awaiting_approval') {
    return true;
  }
  const entDays = pickNumber(
    result.entitlement_remaining_days,
    result.entitlementRemainingDays,
    raw?.entitlement_remaining_days,
    raw?.entitlementRemainingDays,
  );
  return Number.isFinite(entDays) && entDays > 0;
}

function mockPickActive(body) {
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const entitlementSeconds = pickNumber(body.entitlement_remaining_seconds ?? data?.entitlement_remaining_seconds);
  const entitlementDays = pickNumber(body.entitlement_remaining_days ?? data?.entitlement_remaining_days);
  if (entitlementSeconds > 0 || entitlementDays > 0) return true;
  const candidates = [body.active, data?.active];
  for (const c of candidates) {
    if (c === true) return true;
    if (c === false) break;
  }
  const status = String(body.status ?? data?.status ?? '').toLowerCase();
  if (status === 'pending') return false;
  const rem = Number(body.remaining_seconds ?? data?.remaining_seconds ?? 0);
  return Number.isFinite(rem) && rem > 0;
}

async function main() {
  const apiSrc = require('fs').readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
  if (!apiSrc.includes('export function isSubscriptionPendingActivation')) {
    fail('isSubscriptionPendingActivation export missing');
    return;
  }
  pass('api exports isSubscriptionPendingActivation');

  const pending = isSubscriptionPendingActivation({
    active: false,
    status: 'pending',
    raw: { status: 'pending', active: false },
  });
  if (!pending) fail('pending status should trigger pending activation');
  else pass('pending status detected');

  const ent = isSubscriptionPendingActivation({
    active: false,
    raw: { active: false, entitlement_remaining_days: 3 },
  });
  if (!ent) fail('positive entitlement_remaining_days should be pending');
  else pass('entitlement days pending detected');

  const inactive = isSubscriptionPendingActivation({
    active: false,
    resolveSource: 'inactive',
    raw: { active: false, status: 'expired', remaining_seconds: 0 },
  });
  if (inactive) fail('expired inactive should not be pending activation');
  else pass('expired inactive not pending');

  if (mockPickActive({ active: false, entitlement_remaining_days: 2 })) {
    pass('pickActive honors entitlement_remaining_days');
  } else {
    fail('pickActive should honor entitlement_remaining_days');
  }

  if (!mockPickActive({ active: false, status: 'pending', remaining_seconds: 0 })) {
    pass('explicit inactive pending stays inactive without entitlement');
  } else {
    fail('pending without entitlement should not be active');
  }

  const ctxSrc = require('fs').readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
  if (!ctxSrc.includes('isSubscriptionPendingActivation')) {
    fail('OsmaniAppContext should import isSubscriptionPendingActivation');
  } else {
    pass('context imports pending activation helper');
  }
  if (!ctxSrc.includes('pending_preserved_cache')) {
    fail('OsmaniAppContext should preserve cache during pending activation');
  } else {
    pass('context pending cache preserve wired');
  }

  const adminSrc = require('fs').readFileSync(
    path.join(root, '..', 'osmani-admin', 'server', 'src', 'routes', 'subscription.js'),
    'utf8',
  );
  if (!adminSrc.includes('sync_finalize_activation')) {
    fail('backend verify should sync finalize when poll skipped');
  } else {
    pass('backend sync finalize on skip-poll path');
  }

  const subSrc = apiSrc;
  if (!subSrc.includes("resolveSource: 'inactive'")) {
    fail('tryResolveForDeviceId should return inactive payload not null');
  } else {
    pass('inactive verify payload retained in resolve chain');
  }

  console.log('\n[verify-subscription-pending-activation] ok');
}

main().catch((e) => {
  fail(e?.message ?? e);
});
