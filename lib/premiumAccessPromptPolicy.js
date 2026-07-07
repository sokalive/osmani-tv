/**
 * Premium payment modal display policy — explicit tap intent + authoritative entitlement only.
 */

import { mayOpenPaymentPopup } from './entitlementStateMachine';
import { hasFreshPremiumAccessIntent } from './premiumAccessIntent';

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function mayOpenPremiumModalFromExplicitTap(snapshot) {
  if (!hasFreshPremiumAccessIntent()) return false;
  const phase = snapshot?.entitlementPhase;
  return mayOpenPaymentPopup(phase);
}
