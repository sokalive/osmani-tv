/**
 * Premium channel tap — tri-state entitlement (active / inactive / resolving).
 * Never treat unresolved false as confirmed inactive (cold-start race fix).
 */

import { withTimeout } from './asyncTimeout';

/** Hard cap for warm-path tap snapshot wait (ms). */
export const PREMIUM_GATE_MAX_MS = 800;

/** Cold-start entitlement resolution cap — matches recover-boot budget. */
export const PREMIUM_TAP_RESOLVE_MS = 8_500;

/** @typedef {'active'|'inactive'|'resolving'} EntitlementState */

/**
 * @param {object} snapshot
 * @returns {object}
 */
export function withEntitlementState(snapshot) {
  const s = snapshot ?? {};
  const active = s.isSubscribed === true;
  const ready = s.premiumPlaybackReady === true;
  /** @type {EntitlementState} */
  let entitlementState = 'resolving';
  if (active) entitlementState = 'active';
  else if (ready) entitlementState = 'inactive';
  return { ...s, entitlementState };
}

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotHasActiveSubscription(snapshot) {
  return snapshot?.isSubscribed === true;
}

/**
 * Confirmed inactive — sync complete and not subscribed. Never true while boot unresolved.
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotIsConfirmedInactive(snapshot) {
  if (snapshot?.entitlementState === 'inactive') return true;
  return snapshot?.premiumPlaybackReady === true && snapshot?.isSubscribed !== true;
}

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotIsResolving(snapshot) {
  if (snapshot?.entitlementState === 'resolving') return true;
  return !snapshotHasActiveSubscription(snapshot) && !snapshotIsConfirmedInactive(snapshot);
}

/**
 * Wait for access snapshot helpers. Never short-circuit unresolved false as inactive.
 *
 * @param {() => object} getSnapshot
 * @param {() => Promise<object>} awaitSnapshot
 * @returns {Promise<object>}
 */
export async function awaitPremiumSnapshotCapped(getSnapshot, awaitSnapshot) {
  const initial = withEntitlementState(getSnapshot?.());
  if (initial.entitlementState === 'active') return initial;
  if (initial.entitlementState === 'inactive') return initial;

  const cap =
    initial.subscriptionSyncLoaded === false ? PREMIUM_TAP_RESOLVE_MS : PREMIUM_GATE_MAX_MS;

  try {
    await withTimeout(Promise.resolve(awaitSnapshot?.()), cap, 'premium-tap-gate');
  } catch {
    /* timeout — fall through to latest snapshot */
  }
  return withEntitlementState(getSnapshot?.() ?? initial);
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
