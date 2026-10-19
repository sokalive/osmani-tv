/**
 * Payment plans — in-memory + AsyncStorage cache for instant PremiumModal render.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPlans } from '../api/payment';

const STORAGE_KEY = 'osmani:payment_plans_v1';

/** Max spinner on first install when no cache exists. */
export const PAYMENT_PLANS_FIRST_SPINNER_MAX_MS = 500;

/** @type {NormalizedPaymentPlan[]|null} */
let memoryCache = null;

/** @type {Promise<NormalizedPaymentPlan[]|null>|null} */
let refreshPromise = null;
/** Set when another refresh is requested while one is already running. */
let pendingReason = null;
/** Bumped when a newer refresh is requested so an older response cannot be stored. */
let plansEpoch = 0;

/**
 * @typedef {{ id: string; name: string; price: number; duration: string; isActive: boolean }} NormalizedPaymentPlan
 */

/**
 * @param {unknown} raw
 * @returns {NormalizedPaymentPlan}
 */
export function normalizePaymentPlanRow(raw) {
  const explicitlyInactive = raw?.is_active === false || raw?.isActive === false;
  const explicitlyActive = raw?.is_active === true || raw?.isActive === true;
  const hasIdentity =
    String(raw?.id ?? raw?.plan_id ?? '').trim() !== '' ||
    String(raw?.name ?? raw?.title ?? '').trim() !== '';
  const active = explicitlyActive || (!explicitlyInactive && hasIdentity);
  return {
    id: String(raw?.id ?? raw?.plan_id ?? '').trim(),
    name: String(raw?.name ?? raw?.title ?? '').trim(),
    price: Number(raw?.price ?? raw?.amount ?? 0),
    duration: String(
      raw?.duration_days ??
        raw?.durationDays ??
        raw?.days ??
        raw?.validity_days ??
        raw?.validityDays ??
        raw?.period_days ??
        raw?.periodDays ??
        raw?.duration ??
        raw?.duration_label ??
        raw?.duration_text ??
        '',
    ).trim(),
    isActive: active,
  };
}

/**
 * @param {unknown} rawList
 * @returns {NormalizedPaymentPlan[]}
 */
export function normalizePaymentPlansList(rawList) {
  if (!Array.isArray(rawList)) return [];
  /** @type {NormalizedPaymentPlan[]} */
  const out = [];
  const seenIds = new Set();
  for (const raw of rawList) {
    const plan = normalizePaymentPlanRow(raw);
    if (!plan.isActive || !plan.id) continue;
    if (seenIds.has(plan.id)) continue;
    seenIds.add(plan.id);
    out.push(plan);
  }
  return out;
}

/**
 * @param {NormalizedPaymentPlan[]} plans
 */
function plansFingerprint(plans) {
  return plans.map((p) => `${p.id}:${p.price}:${p.duration}`).join('|');
}

/**
 * Synchronous read — memory only (call hydratePaymentPlansCacheFromStorage on boot first).
 * @returns {NormalizedPaymentPlan[]|null}
 */
export function getCachedPaymentPlansSync() {
  return memoryCache?.length ? memoryCache : null;
}

/**
 * Load persisted plans into memory.
 * @returns {Promise<NormalizedPaymentPlan[]|null>}
 */
export async function hydratePaymentPlansCacheFromStorage() {
  if (memoryCache?.length) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const list = normalizePaymentPlansList(parsed);
    if (list.length) {
      memoryCache = list;
      console.log('[PAYMENT_PLANS_CACHE]', 'hydrated_storage', { count: list.length });
    }
    return list.length ? list : null;
  } catch (e) {
    console.log('[PAYMENT_PLANS_CACHE]', 'hydrate_storage_error', e?.message ?? e);
    return null;
  }
}

/**
 * @param {unknown} rawList
 * @param {{ source?: string }} [opts]
 * @returns {Promise<NormalizedPaymentPlan[]|null>}
 */
export async function writePaymentPlansCache(rawList, opts = {}) {
  const list = normalizePaymentPlansList(rawList);
  if (!list.length) return memoryCache;
  const source = opts.source ?? 'network';
  const changed = !memoryCache || plansFingerprint(memoryCache) !== plansFingerprint(list);
  memoryCache = list;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.log('[PAYMENT_PLANS_CACHE]', 'persist_error', e?.message ?? e);
  }
  if (changed) {
    console.log('[PAYMENT_PLANS_CACHE]', 'updated', { count: list.length, source });
  }
  return list;
}

/**
 * @param {unknown} plans
 */
export async function seedPaymentPlansCacheFromVerify(plans) {
  if (!Array.isArray(plans) || plans.length === 0) return;
  await writePaymentPlansCache(plans, { source: 'verify' });
}

/**
 * Fetch /api/plans and update cache. Deduped in-flight.
 * @param {{ reason?: string }} [opts]
 * @returns {Promise<NormalizedPaymentPlan[]|null>}
 */
async function fetchPlansOnce(reason, epoch) {
  try {
    const raw = await getPlans({ cacheBust: true });
    if (epoch !== plansEpoch) return getCachedPaymentPlansSync();
    return await writePaymentPlansCache(raw, { source: reason });
  } catch (e) {
    console.log('[PAYMENT_PLANS_CACHE]', 'refresh_failed', reason, e?.message ?? e);
    const mem = getCachedPaymentPlansSync();
    if (mem?.length) return mem;
    return hydratePaymentPlansCacheFromStorage();
  }
}

export async function refreshPaymentPlansCache(opts = {}) {
  const reason = opts.reason ?? 'background';
  plansEpoch += 1;
  const epoch = plansEpoch;
  if (refreshPromise) {
    pendingReason = reason;
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      let result = await fetchPlansOnce(reason, epoch);
      while (pendingReason) {
        const next = pendingReason;
        pendingReason = null;
        result = await fetchPlansOnce(next, plansEpoch);
      }
      return result;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Pick default selected plan preserving prior selection when possible.
 * @param {NormalizedPaymentPlan[]} list
 * @param {NormalizedPaymentPlan|null|undefined} prev
 */
export function pickDefaultPaymentPlan(list, prev) {
  if (!list?.length) return null;
  if (prev && list.some((x) => x.id === prev.id)) return prev;
  return list[0] ?? null;
}
