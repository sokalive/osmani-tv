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
  if (initial?.isSubscribed === false) return initial;

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

/**
 * Premium channel card badge — same entitlement fields as {@link snapshotHasActiveSubscription}.
 * @param {{ isPremium?: boolean; freeMode?: boolean; isSubscribed?: boolean }} input
 */
export function shouldShowKulipiaBadge(input) {
  if (!input?.isPremium) return false;
  if (input?.freeMode) return false;
  return input?.isSubscribed !== true;
}

/**
 * Non-blocking subscription reconcile after immediate navigation (d3ba89c cache-first).
 * @param {(reason?: string) => Promise<boolean>} verifyFn
 * @param {string} [reason]
 */
export function verifySubscriptionInBackground(verifyFn, reason = 'channel-tap') {
  if (!verifyFn) return;
  void verifyFn(`gate-bg:${reason}`);
}
