/**
 * Merge subscription detail payloads — never replace good UI fields with sparse verify data.
 */

function hasDetailValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * @param {Record<string, unknown>|null|undefined} prev
 * @param {Record<string, unknown>|null|undefined} incoming
 * @returns {Record<string, unknown>|null}
 */
export function mergeSubscriptionDetails(prev, incoming) {
  if (!incoming) return null;
  if (!prev) return { ...incoming };
  const merged = { ...incoming };
  const stickyFields = [
    'amount',
    'currency',
    'planName',
    'planId',
    'planDurationDays',
    'plan_duration_days',
    'displayDurationDays',
    'startedAt',
    'periodStartAt',
    'remainingDays',
    'remaining_days',
    'remainingSeconds',
    'remaining_seconds',
  ];
  for (const field of stickyFields) {
    if (!hasDetailValue(incoming[field]) && hasDetailValue(prev[field])) {
      merged[field] = prev[field];
    }
  }
  const incomingPlans = Array.isArray(incoming.plans) ? incoming.plans : [];
  const prevPlans = Array.isArray(prev.plans) ? prev.plans : [];
  if (incomingPlans.length === 0 && prevPlans.length > 0) {
    merged.plans = prevPlans;
  }
  // Manual gift popup is server-authoritative — never preserve stale keys across sparse merges.
  if ('manualGiftShowPopup' in incoming) {
    merged.manualGiftShowPopup = incoming.manualGiftShowPopup === true;
  } else {
    merged.manualGiftShowPopup = false;
  }
  if ('manualGiftAckKey' in incoming) {
    merged.manualGiftAckKey = hasDetailValue(incoming.manualGiftAckKey)
      ? incoming.manualGiftAckKey
      : null;
  } else if (merged.manualGiftShowPopup !== true) {
    merged.manualGiftAckKey = null;
  }
  return merged;
}

/**
 * Persistable plan snapshot for AsyncStorage (Account screen cards).
 * @param {Record<string, unknown>|null|undefined} details
 */
export function extractPlanSnapshotFromDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const planDurationDays =
    details.planDurationDays ?? details.plan_duration_days ?? null;
  const snapshot = {
    amount: details.amount ?? null,
    currency: details.currency ?? null,
    planName: details.planName ?? null,
    planId: details.planId ?? details.plan_id ?? null,
    planDurationDays,
    plan_duration_days: planDurationDays,
    startedAt: details.startedAt ?? details.periodStartAt ?? null,
    periodStartAt: details.periodStartAt ?? details.startedAt ?? null,
    expiresAt: details.expiresAt ?? null,
    displayDurationDays: details.displayDurationDays ?? null,
    remainingDays: details.remainingDays ?? details.remaining_days ?? null,
    remainingSeconds: details.remainingSeconds ?? details.remaining_seconds ?? null,
    plans: Array.isArray(details.plans) && details.plans.length > 0 ? details.plans : [],
  };
  const hasPlanData =
    hasDetailValue(snapshot.amount) ||
    hasDetailValue(snapshot.planName) ||
    hasDetailValue(snapshot.planId) ||
    hasDetailValue(snapshot.planDurationDays) ||
    hasDetailValue(snapshot.displayDurationDays) ||
    snapshot.plans.length > 0;
  return hasPlanData ? snapshot : null;
}

/**
 * @param {Record<string, unknown>|null|undefined} cachedSnapshot
 */
export function subscriptionDetailsFromPlanSnapshot(cachedSnapshot, expiresAt = null) {
  if (!cachedSnapshot || typeof cachedSnapshot !== 'object') return null;
  return {
    amount: cachedSnapshot.amount ?? null,
    currency: cachedSnapshot.currency ?? null,
    planName: cachedSnapshot.planName ?? null,
    planId: cachedSnapshot.planId ?? cachedSnapshot.plan_id ?? null,
    planDurationDays:
      cachedSnapshot.planDurationDays ?? cachedSnapshot.plan_duration_days ?? null,
    plan_duration_days:
      cachedSnapshot.plan_duration_days ?? cachedSnapshot.planDurationDays ?? null,
    startedAt: cachedSnapshot.startedAt ?? cachedSnapshot.periodStartAt ?? null,
    periodStartAt: cachedSnapshot.periodStartAt ?? cachedSnapshot.startedAt ?? null,
    expiresAt: cachedSnapshot.expiresAt ?? expiresAt ?? null,
    displayDurationDays: cachedSnapshot.displayDurationDays ?? null,
    remainingDays: cachedSnapshot.remainingDays ?? cachedSnapshot.remaining_days ?? null,
    remainingSeconds: cachedSnapshot.remainingSeconds ?? cachedSnapshot.remaining_seconds ?? null,
    serverTime: null,
    serverTimeFetchedAt: Date.now(),
    plans: Array.isArray(cachedSnapshot.plans) ? cachedSnapshot.plans : [],
    transportPreserved: true,
    cacheHydrated: true,
  };
}
