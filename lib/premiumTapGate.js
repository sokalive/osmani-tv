/**
 * Premium channel tap — canonical entitlement phase (never treat CHECKING as INACTIVE).
 */

import { withTimeout } from './asyncTimeout';
import {
  snapshotHasActiveSubscription,
  snapshotIsConfirmedInactive,
  snapshotIsResolving,
  snapshotIsReadyForPaymentFlow,
  snapshotNeedsEntitlementAwait,
  withCanonicalEntitlement,
} from './entitlementStateMachine';

/** Hard cap for warm-path tap snapshot wait (ms). */
export const PREMIUM_GATE_MAX_MS = 800;

/** Cold-start entitlement resolution cap — matches recover-boot budget. */
export const PREMIUM_TAP_RESOLVE_MS = 8_500;

/** @typedef {import('./entitlementStateMachine').EntitlementPhase} EntitlementPhase */

export {
  snapshotHasActiveSubscription,
  snapshotIsConfirmedInactive,
  snapshotIsResolving,
};

/** @deprecated use withCanonicalEntitlement */
export function withEntitlementState(snapshot) {
  return withCanonicalEntitlement(snapshot);
}

/**
 * Wait for access snapshot helpers. Never short-circuit unresolved false as inactive.
 *
 * @param {() => object} getSnapshot
 * @param {() => Promise<object>} awaitSnapshot
 * @returns {Promise<object>}
 */
export async function awaitPremiumSnapshotCapped(getSnapshot, awaitSnapshot) {
  const initial = withCanonicalEntitlement(getSnapshot?.());
  if (initial.entitlementState === 'active') return initial;
  if (initial.entitlementState === 'inactive') return initial;

  const cap =
    initial.subscriptionSyncLoaded === false ? PREMIUM_TAP_RESOLVE_MS : PREMIUM_GATE_MAX_MS;

  try {
    await withTimeout(Promise.resolve(awaitSnapshot?.()), cap, 'premium-tap-gate');
  } catch {
    /* timeout — fall through to latest snapshot */
  }
  return withCanonicalEntitlement(getSnapshot?.() ?? initial);
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
