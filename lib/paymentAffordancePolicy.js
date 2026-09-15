/**
 * Payment affordance vs entitlement authorization — decoupled from bootstrap completion.
 *
 * - PAYMENT AFFORDANCE (KULIPIA badge, unpaid tap entry) must not wait for subscriptionSyncLoaded
 *   once cache hydrate has settled empty (true unpaid boot).
 * - NEVER invent unpaid/KULIPIA while a trusted active entitlement exists, while CHECKING
 *   before hydrate settles, or while ERROR_UNKNOWN (transport).
 * - ENTITLEMENT AUTHORIZATION (channel playback) still uses trusted active evidence.
 */

import {
  deriveEntitlementPhase,
  mayNavigatePremiumImmediate,
  mayOpenPaymentPopup,
  snapshotHasActiveSubscription,
} from './entitlementStateMachine';

/**
 * Same-device trusted active entitlement (server or unexpired cache).
 * @param {object} [snapshot]
 * @returns {boolean}
 */
export function hasTrustedActiveEntitlement(snapshot) {
  return snapshotHasActiveSubscription(snapshot);
}

/**
 * KULIPIA badge — payment affordance.
 * Known ACTIVE / STALE_ACTIVE must never flash unpaid. Transport ERROR_UNKNOWN must not
 * invent unpaid. CHECKING before cache-hydrate settles must not invent unpaid.
 *
 * @param {{
 *   isPremium?: boolean;
 *   freeMode?: boolean;
 *   isSubscribed?: boolean;
 *   cacheTrustedActive?: boolean;
 *   entitlementPhase?: string;
 *   subscriptionSyncLoaded?: boolean;
 *   subscriptionCacheHydrateAttempted?: boolean;
 *   authoritativeInactiveConfirmed?: boolean;
 * }} input
 * @returns {boolean}
 */
export function mayShowPaymentAffordance(input) {
  if (!input?.isPremium || input?.freeMode) return false;
  if (input?.isSubscribed === true || input?.cacheTrustedActive === true) return false;

  const phase =
    input?.entitlementPhase ??
    deriveEntitlementPhase({
      isSubscribed: input?.isSubscribed === true,
      cacheTrustedActive: input?.cacheTrustedActive === true,
      authoritativeInactiveConfirmed: input?.authoritativeInactiveConfirmed === true,
      subscriptionSyncLoaded: input?.subscriptionSyncLoaded === true,
    });

  if (phase === 'ACTIVE' || phase === 'STALE_ACTIVE') return false;
  if (phase === 'INACTIVE' || phase === 'EXPIRED') return true;
  // Transport / ambiguous verify — preserve known non-unpaid UI (no flash).
  if (phase === 'ERROR_UNKNOWN') return false;
  // Still resolving: only show after cache hydrate settled empty (true unpaid boot).
  if (phase === 'CHECKING') {
    return input?.subscriptionCacheHydrateAttempted === true;
  }
  // UNKNOWN after sync — never-subscribed / unpaid.
  if (input?.subscriptionSyncLoaded === true) return true;
  return input?.subscriptionCacheHydrateAttempted === true;
}

/**
 * Explicit premium tap may open full PremiumModal without waiting for bootstrap.
 * Never when trusted active evidence exists.
 * @param {object} [snapshot]
 * @returns {boolean}
 */
export function mayOpenPaymentOnExplicitTap(snapshot) {
  const s = snapshot ?? {};
  if (hasTrustedActiveEntitlement(s)) return false;
  const phase = s.entitlementPhase ?? deriveEntitlementPhase(s);
  if (mayOpenPaymentPopup(phase)) return true;
  if (mayNavigatePremiumImmediate(phase) || s.cacheTrustedActive === true) return false;
  return true;
}

/**
 * CHECKING/ERROR_UNKNOWN may still resolve to active — bounded guard only, not payment block.
 * @param {object} [snapshot]
 * @returns {boolean}
 */
export function explicitTapNeedsBoundedActiveGuard(snapshot) {
  const s = snapshot ?? {};
  if (hasTrustedActiveEntitlement(s)) return false;
  const phase = s.entitlementPhase ?? deriveEntitlementPhase(s);
  return phase === 'CHECKING' || phase === 'ERROR_UNKNOWN';
}
