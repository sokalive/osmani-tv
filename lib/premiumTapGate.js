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
import { explicitTapNeedsBoundedActiveGuard } from './paymentAffordancePolicy';

/** Hard cap for warm-path tap snapshot wait (ms). */
export const PREMIUM_GATE_MAX_MS = 800;

/** Cold-start entitlement resolution cap — matches recover-boot budget. */
export const PREMIUM_TAP_RESOLVE_MS = 8_500;

/** Bounded wait for same-device active cache before unpaid payment affordance. */
export const EXPLICIT_TAP_ACTIVE_GUARD_MS = 1_200;

/** Quick cache hydrate before explicit tap decision. */
export const EXPLICIT_TAP_HYDRATE_MS = 350;

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
 * Explicit premium tap snapshot — never block unpaid users on full bootstrap.
 * Short cache hydrate + bounded active guard for cold-start subscribers only.
 *
 * @param {() => object} getSnapshot
 * @param {{ hydrateCache?: () => void | Promise<void> }} [options]
 * @returns {Promise<object>}
 */
export async function resolveExplicitPremiumTapSnapshot(getSnapshot, options = {}) {
  const { hydrateCache } = options;

  if (hydrateCache) {
    try {
      await withTimeout(Promise.resolve(hydrateCache()), EXPLICIT_TAP_HYDRATE_MS, 'tap-hydrate');
    } catch {
      /* proceed with latest snapshot */
    }
  }

  let snap = withCanonicalEntitlement(getSnapshot?.() ?? {});
  if (snapshotHasActiveSubscription(snap)) return snap;
  if (!explicitTapNeedsBoundedActiveGuard(snap)) return snap;

  const deadline = Date.now() + EXPLICIT_TAP_ACTIVE_GUARD_MS;
  while (Date.now() < deadline) {
    snap = withCanonicalEntitlement(getSnapshot?.() ?? snap);
    if (snapshotHasActiveSubscription(snap)) return snap;
    if (snap.subscriptionSyncLoaded === true) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return withCanonicalEntitlement(getSnapshot?.() ?? snap);
}

/**
 * Premium channel card badge — payment affordance, not bootstrap completion.
 * @param {{ isPremium?: boolean; freeMode?: boolean; isSubscribed?: boolean; cacheTrustedActive?: boolean }} input
 */
export function shouldShowKulipiaBadge(input) {
  if (!input?.isPremium || input?.freeMode) return false;
  if (input?.isSubscribed === true || input?.cacheTrustedActive === true) return false;
  return true;
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
