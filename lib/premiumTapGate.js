/**
 * Premium channel tap — never block on cold-start recover/verify (max 800ms).
 */

import { withTimeout } from './asyncTimeout';

/** Hard cap for premium tap / player initial gate (ms). */
export const PREMIUM_GATE_MAX_MS = 800;

/**
 * Wait for access snapshot helpers, but never longer than {@link PREMIUM_GATE_MAX_MS}.
 *
 * @param {() => object} getSnapshot
 * @param {() => Promise<object>} awaitSnapshot
 * @returns {Promise<object>}
 */
export async function awaitPremiumSnapshotCapped(getSnapshot, awaitSnapshot) {
  const initial = getSnapshot?.();
  if (initial?.premiumPlaybackReady) return initial;
  if (initial?.isSubscribed === true) return initial;

  try {
    await withTimeout(Promise.resolve(awaitSnapshot?.()), PREMIUM_GATE_MAX_MS, 'premium-tap-gate');
  } catch {
    /* timeout — fall through to latest snapshot */
  }
  return getSnapshot?.() ?? initial ?? {};
}

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotHasActiveSubscription(snapshot) {
  return snapshot?.isSubscribed === true;
}
