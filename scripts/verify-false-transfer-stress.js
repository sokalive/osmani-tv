#!/usr/bin/env node
'use strict';

/**
 * Stress-simulate false transfer popup guards (100× recovery / alias / user transfer cases).
 * Run: node scripts/verify-false-transfer-stress.js
 */

function isExplicitTransferRevokeReason(sseReason) {
  const r = String(sseReason ?? '').trim().toLowerCase();
  if (!r) return false;
  if (
    r === 'recovery' ||
    r === 'admin_force' ||
    r === 'security_force_logout' ||
    r.includes('migration') ||
    r.includes('recover')
  ) {
    return false;
  }
  return (
    r === 'transferred' ||
    r === 'transfer' ||
    r === 'transfer_confirmed' ||
    r === 'confirmed_by_code' ||
    r.endsWith('_transfer')
  );
}

function isUserConfirmedTransferReason(sseReason) {
  const r = String(sseReason ?? '').trim().toLowerCase();
  return r === 'transfer_confirmed' || r === 'confirmed_by_code' || r === 'transfer_confirm';
}

function pickTransferSseReason(payload, eventName = '') {
  if (!payload || typeof payload !== 'object') return '';
  const raw =
    payload.reason ??
    payload.transfer_reason ??
    payload.transferReason ??
    (eventName.includes('transfer') ? eventName : '');
  return raw != null ? String(raw).trim() : '';
}

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failures += 1;
  }
}

const recoveryReasons = ['recovery', 'admin_force', 'security_force_logout', 'device_migration', 'recover_stale'];
const transferReasons = ['transferred', 'transfer_confirmed', 'confirmed_by_code', 'transfer'];

for (let i = 0; i < 100; i += 1) {
  for (const r of recoveryReasons) {
    assert(!isExplicitTransferRevokeReason(r), `recovery must not revoke: ${r} @${i}`);
    assert(!isUserConfirmedTransferReason(r), `recovery must not be user transfer: ${r} @${i}`);
  }
  for (const r of transferReasons) {
    assert(isExplicitTransferRevokeReason(r), `transfer must revoke: ${r} @${i}`);
  }
  assert(isUserConfirmedTransferReason('transfer_confirmed'), `user confirmed @${i}`);
  assert(isUserConfirmedTransferReason('confirmed_by_code'), `code confirmed @${i}`);
  assert(!isUserConfirmedTransferReason('recovery'), `recovery not user @${i}`);

  const payload = { reason: 'recovery', source_device_id: 'ABC', target_device_id: 'DEF' };
  assert(pickTransferSseReason(payload, 'transfer_completed') === 'recovery', `pick reason @${i}`);
}

if (failures) {
  console.error(`\n[verify-false-transfer-stress] ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n[verify-false-transfer-stress] 100× ok');
