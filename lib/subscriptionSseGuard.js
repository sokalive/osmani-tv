/**
 * Guards subscription / transfer SSE handlers against global broadcasts.
 * Backend /api/sync/stream may emit transfer lifecycle events to all
 * connected clients — only act when payload device ids match this install.
 */

import { isSubscriptionTransportFailure } from '../api/subscription';
import { getDeviceIdentity } from './deviceIdentity';

function pickPayloadString(payload, keys) {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of keys) {
    const value = key
      .split('.')
      .reduce(
        (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
        payload,
      );
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

/** Unwrap `{ event, payload }` admin SSE envelopes. */
export function unwrapSubscriptionSsePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.payload && typeof payload.payload === 'object') return payload.payload;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function normalizeDeviceId(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** @returns {Promise<Set<string>>} */
export async function currentDeviceIdSet() {
  const identity = await getDeviceIdentity();
  const ids = new Set();
  const add = (v) => {
    const n = normalizeDeviceId(v);
    if (n) ids.add(n);
  };
  add(identity.deviceId);
  add(identity.subscriptionDeviceId);
  add(identity.androidId);
  add(identity.legacyPackageAndroidId);
  add(identity.packageAndroidId);
  add(identity.displayedAccountId);
  if (Array.isArray(identity.identityCandidates)) {
    for (const c of identity.identityCandidates) {
      add(c?.deviceId);
    }
  }
  return ids;
}

/**
 * Which side of a transfer lifecycle event this install is on.
 * @returns {Promise<'source'|'target'|'device'|'none'|'other'>}
 */
export async function subscriptionTransferSseRole(payload, eventName = '') {
  const inner = unwrapSubscriptionSsePayload(payload);
  if (!inner || typeof inner !== 'object') return 'none';

  const ids = await currentDeviceIdSet();
  const matches = (raw) => {
    const n = normalizeDeviceId(raw);
    return Boolean(n && ids.has(n));
  };

  const source = pickPayloadString(inner, [
    'source_device_id',
    'sourceDeviceId',
    'source_device.device_id',
    'source_device.id',
    'from_device_id',
    'fromDeviceId',
  ]);
  const target = pickPayloadString(inner, [
    'target_device_id',
    'targetDeviceId',
    'target_device.device_id',
    'target_device.id',
    'to_device_id',
    'toDeviceId',
  ]);
  const device = pickPayloadString(inner, [
    'device_id',
    'deviceId',
    'lost_device_id',
    'lostDeviceId',
    'previous_device_id',
    'previousDeviceId',
    'revoked_device_id',
    'revokedDeviceId',
  ]);

  const hasAnyId = Boolean(source || target || device);
  if (!hasAnyId) {
    console.log('[SUBSCRIPTION_SSE_GUARD]', 'ignored_no_device_ids', { eventName });
    return 'none';
  }

  if (source && matches(source)) return 'source';
  if (target && matches(target)) return 'target';
  if (device && matches(device)) return 'device';

  console.log('[SUBSCRIPTION_SSE_GUARD]', 'ignored_other_device', {
    eventName,
    source: source ? `${source.slice(0, 8)}…` : null,
    target: target ? `${target.slice(0, 8)}…` : null,
    device: device ? `${device.slice(0, 8)}…` : null,
  });
  return 'other';
}

/** True only when verify confirms backend says inactive (not transport glitch). */
export function isConfirmedSubscriptionLoss(verifyResult) {
  if (!verifyResult || verifyResult.active === true) return false;
  if (verifyResult.transportPreserved === true) return false;
  if (isSubscriptionTransportFailure(verifyResult)) return false;
  const src = String(verifyResult.resolveSource ?? '');
  if (src.startsWith('transport:')) return false;
  return src === 'inactive';
}
