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
 * @param {unknown} payload
 * @returns {Promise<boolean>}
 */
export async function sseGrantTargetsThisDevice(payload) {
  const inner = unwrapSubscriptionSsePayload(payload);
  const deviceId = pickSubscriptionSseDeviceId(inner);
  // Fail-closed: grants without a device id must NEVER hydrate this device's Account.
  // Backend always targets a device; missing id is treated as not-for-me (isolation).
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
 * @param {unknown} payload
 * @param {string} eventName
 */
export function parseInstantSubscriptionFromSse(payload, eventName) {
  const inner = unwrapSubscriptionSsePayload(payload);
  const ev = String(eventName || '');
  const fallback =
    GRANT_SSE_EVENTS.has(eventName) ||
    ev.includes('subscription') ||
    ev.includes('transfer')
      ? { active: true }
      : {};
  return parseSubscriptionPayload(inner, fallback);
}

export function isActivationSuccessSseEvent(eventName) {
  return GRANT_SSE_EVENTS.has(eventName);
}
