import AsyncStorage from '@react-native-async-storage/async-storage';
import { readSubscriptionCache } from '../api/subscription';
import { getDeviceIdentity } from './deviceIdentity';
import { subscriptionDetailsFromPlanSnapshot } from './subscriptionDetailsMerge';
import { enrichCanonicalSubscriptionTiming } from './subscriptionCanonical';
import { isTrustworthyActiveCache } from './entitlementStateMachine';

const ANDROID_ID_CACHE_KEY = 'osmani:android_id_v1';
const LEGACY_DEVICE_ID_KEY = 'osmani:legacy_device_id_v1';
const STABLE_HARDWARE_ID_KEY = 'osmani:stable_hardware_id_v1';

async function readStoredIdentityHints() {
  const hints = new Set();
  try {
    const keys = [ANDROID_ID_CACHE_KEY, LEGACY_DEVICE_ID_KEY, STABLE_HARDWARE_ID_KEY];
    const vals = await AsyncStorage.multiGet(keys);
    for (const [, v] of vals) {
      const s = String(v ?? '').trim();
      if (s) hints.add(s);
    }
  } catch {
    /* ignore */
  }
  return hints;
}

/** True when cached active flag belongs to this install (any identity candidate). */
export function isSameDeviceSubscriptionCache(cached, identity) {
  if (!cached?.active) return false;
  if (!cached.deviceId) return isTrustworthyActiveCache(cached);
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
  const cached = await readSubscriptionCache();
  if (!isTrustworthyActiveCache(cached)) {
    return { cached: null, identity: null };
  }
  let identity;
  try {
    identity = await getDeviceIdentity();
  } catch {
    identity = { deviceId: '', androidId: null };
  }
  if (isSameDeviceSubscriptionCache(cached, identity)) {
    return { cached, identity };
  }
  const hints = await readStoredIdentityHints();
  if (cached.deviceId && hints.has(String(cached.deviceId).trim())) {
    return { cached, identity };
  }
  return { cached: null, identity };
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
    manualGiftShowPopup: result.manualGiftShowPopup === true,
    manualGiftAckKey: result.manualGiftShowPopup === true ? (result.manualGiftAckKey ?? null) : null,
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
    transportPreserved: true,
    cacheHydrated: true,
  };
}
