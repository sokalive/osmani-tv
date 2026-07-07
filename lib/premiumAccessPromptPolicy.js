/**
 * Premium payment modal display policy — explicit tap intent + authoritative entitlement only.
 */

import { deriveEntitlementPhase, mayOpenPaymentPopup } from './entitlementStateMachine';
import { hasFreshPremiumAccessIntent } from './premiumAccessIntent';

/**
 * Authoritative inactive/expired only — no intent check.
 * @param {object} snapshot
 * @returns {boolean}
 */
export function snapshotAuthorizesPremiumPayment(snapshot) {
  const phase = snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot);
  return mayOpenPaymentPopup(phase);
}

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function mayOpenPremiumModalFromExplicitTap(snapshot) {
  if (!hasFreshPremiumAccessIntent()) return false;
  return snapshotAuthorizesPremiumPayment(snapshot);
}
