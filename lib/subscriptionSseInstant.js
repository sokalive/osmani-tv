/**
 * Instant subscription UI from SSE grant/activation events (v1.0.0 responsiveness).
 * Applies optimistic state before background verify — does not grant access alone;
 * paired with reverifySubscription in OsmaniAppContext.
 */

import { parseSubscriptionPayload } from '../api/subscription';
import { SUBSCRIPTION_WAKE_SSE_EVENTS } from './adminSseRefreshEvents';
import {
  currentDeviceIdSet,
  devicesShareIdentity,
  unwrapSubscriptionSsePayload,
} from './subscriptionSseGuard';

const GRANT_SSE_EVENTS = new Set(SUBSCRIPTION_WAKE_SSE_EVENTS);

export function pickSubscriptionSseDeviceId(inner) {
  if (!inner || typeof inner !== 'object') return '';
  const keys = [
    'device_id',
    'deviceId',
    'target_device_id',
    'targetDeviceId',
    'subscription_device_id',
    'subscriptionDeviceId',
    'android_id',
    'androidId',
    'package_android_id',
    'packageAndroidId',
    'legacy_package_android_id',
    'legacyPackageAndroidId',
    'stable_hardware_id',
    'stableHardwareId',
    'install_instance_id',
    'installInstanceId',
  ];
  for (const key of keys) {
    const v = inner[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  const sub = inner.subscription;
  if (sub && typeof sub === 'object') {
    for (const key of keys) {
      const v = sub[key];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

/**
 * Fail closed when payload has no device identity — untargeted grants must not unlock.
 * @param {unknown} payload
 * @returns {Promise<boolean>}
 */
export async function sseGrantTargetsThisDevice(payload) {
  const inner = unwrapSubscriptionSsePayload(payload);
  const deviceId = pickSubscriptionSseDeviceId(inner);
  if (!deviceId) return false;
  const ids = await currentDeviceIdSet();
  const norm = String(deviceId).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (norm && ids.has(norm)) return true;
  for (const id of ids) {
    if (await devicesShareIdentity(id, deviceId)) return true;
  }
  return false;
}

/**
 * Parse SSE grant payload. Never invent active=true without a parseable body —
 * empty / non-object envelopes stay inactive until authoritative verify.
 * @param {unknown} payload
 * @param {string} [_eventName]
 */
export function parseInstantSubscriptionFromSse(payload, _eventName) {
  const inner = unwrapSubscriptionSsePayload(payload);
  if (!inner || typeof inner !== 'object') {
    return parseSubscriptionPayload(null, { active: false });
  }
  return parseSubscriptionPayload(inner, {});
}

export function isActivationSuccessSseEvent(eventName) {
  return GRANT_SSE_EVENTS.has(eventName);
}
