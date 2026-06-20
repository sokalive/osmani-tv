import { readSubscriptionCache } from '../api/subscription';
import { getDeviceIdentity } from './deviceIdentity';

/** True when cached active flag belongs to this install. */
export function isSameDeviceSubscriptionCache(cached, identity) {
  if (!cached?.active) return false;
  const deviceId = String(identity?.deviceId ?? '').trim();
  if (!cached.deviceId) return true;
  if (cached.deviceId === deviceId) return true;
  const androidId = identity?.androidId;
  if (androidId && cached.deviceId === androidId) return true;
  return false;
}

/**
 * Read AsyncStorage subscription hint for immediate UI / playback gates.
 * Backend verify remains authoritative; this avoids false "Huna Usajili" during load.
 */
export async function readHydratableSubscriptionCache() {
  const [cached, identity] = await Promise.all([
    readSubscriptionCache(),
    getDeviceIdentity().catch(() => ({ deviceId: '', androidId: null })),
  ]);
  if (!isSameDeviceSubscriptionCache(cached, identity)) {
    return { cached: null, identity };
  }
  return { cached, identity };
}

function parseCachedNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function subscriptionDetailsFromCache(cached) {
  if (!cached?.active) return null;
  const planDurationDays = parseCachedNumber(cached.planDurationDays);
  return {
    amount: parseCachedNumber(cached.amount),
    currency: cached.currency ?? null,
    planName: cached.planName ?? null,
    planId: cached.planId ?? null,
    planDurationDays,
    plan_duration_days: planDurationDays,
    startedAt: cached.startedAt ?? null,
    expiresAt: cached.expiresAt ?? null,
    serverTime: cached.serverTime ?? null,
    serverTimeFetchedAt: Date.now(),
    plans: [],
    manualGiftAckKey: null,
    transportPreserved: true,
    cacheHydrated: true,
  };
}

export function subscriptionCacheWritePayload(detailSource, { expiresAt, deviceId, fingerprint }) {
  return {
    active: true,
    expiresAt,
    deviceId,
    fingerprint,
    amount: detailSource?.amount ?? null,
    currency: detailSource?.currency ?? null,
    planName: detailSource?.planName ?? null,
    planId: detailSource?.planId ?? null,
    planDurationDays:
      detailSource?.planDurationDays ?? detailSource?.plan_duration_days ?? null,
    startedAt: detailSource?.startedAt ?? null,
    serverTime: detailSource?.serverTime ?? null,
  };
}
