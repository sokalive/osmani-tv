/**
 * Payment affordance vs entitlement authorization — decoupled from bootstrap completion.
 *
 * - PAYMENT AFFORDANCE (KULIPIA badge, unpaid tap entry) must not wait for subscriptionSyncLoaded.
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
 * KULIPIA badge — payment affordance, not authoritative inactive confirmation.
 * @param {{ isPremium?: boolean; freeMode?: boolean; isSubscribed?: boolean; cacheTrustedActive?: boolean }} input
 * @returns {boolean}
 */
export function mayShowPaymentAffordance(input) {
  if (!input?.isPremium || input?.freeMode) return false;
  if (input?.isSubscribed === true || input?.cacheTrustedActive === true) return false;
  return true;
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
