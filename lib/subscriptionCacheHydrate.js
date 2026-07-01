import { readSubscriptionCache } from '../api/subscription';
import { getDeviceIdentity } from './deviceIdentity';
import { subscriptionDetailsFromPlanSnapshot } from './subscriptionDetailsMerge';
import { enrichCanonicalSubscriptionTiming } from './subscriptionCanonical';

/** True when cached active flag belongs to this install (any identity candidate). */
export function isSameDeviceSubscriptionCache(cached, identity) {
  if (!cached?.active) return false;
  if (!cached.deviceId) return true;
  const ids = new Set();
  const add = (v) => {
    const s = String(v ?? '').trim();
    if (s) ids.add(s);
  };
  add(identity?.deviceId);
  add(identity?.subscriptionDeviceId);
  add(identity?.packageAndroidId);
  add(identity?.legacyPackageAndroidId);
  add(identity?.stableHardwareId);
  add(identity?.androidId);
  if (Array.isArray(identity?.identityCandidates)) {
    for (const c of identity.identityCandidates) add(c?.deviceId);
  }
  return ids.has(String(cached.deviceId).trim());
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

/**
 * Build Account/details state from a verify/recover/status payload (not AsyncStorage).
 *
 * @param {Record<string, unknown>|null|undefined} result
 */
export function subscriptionDetailsFromVerifyResult(result) {
  if (!result || result.active !== true) return null;
  return enrichCanonicalSubscriptionTiming({
    amount: result.amount ?? null,
    currency: result.currency ?? null,
    planName: result.planName ?? null,
    planId: result.planId ?? null,
    planDurationDays: result.planDurationDays ?? result.plan_duration_days ?? null,
    plan_duration_days: result.plan_duration_days ?? result.planDurationDays ?? null,
    startedAt: result.startedAt ?? null,
    expiresAt: result.expiresAt ?? null,
    remainingSeconds: result.remainingSeconds ?? result.remaining_seconds ?? null,
    remainingDays: result.remainingDays ?? result.remaining_days ?? null,
    serverTime: result.serverTime ?? null,
    serverTimeFetchedAt: Date.now(),
    plans: Array.isArray(result.plans) ? result.plans : [],
    manualGiftAckKey: result.manualGiftAckKey ?? null,
  });
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
