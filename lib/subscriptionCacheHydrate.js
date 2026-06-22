import { readSubscriptionCache } from '../api/subscription';
import { getDeviceIdentity } from './deviceIdentity';
import { subscriptionDetailsFromPlanSnapshot } from './subscriptionDetailsMerge';

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

export function subscriptionDetailsFromCache(cached) {
  if (!cached?.active) return null;
  const fromSnapshot = subscriptionDetailsFromPlanSnapshot(
    cached.planSnapshot,
    cached.expiresAt ?? null,
  );
  if (fromSnapshot) return fromSnapshot;
  return {
    amount: null,
    currency: null,
    planName: null,
    planId: null,
    planDurationDays: null,
    plan_duration_days: null,
    startedAt: null,
    expiresAt: cached.expiresAt ?? null,
    serverTime: null,
    serverTimeFetchedAt: Date.now(),
    plans: [],
    manualGiftAckKey: null,
    transportPreserved: true,
    cacheHydrated: true,
  };
}
