/**
 * Premium access prompt display policy — intent + authoritative entitlement only.
 */

import { mayOpenPaymentPopup } from './entitlementStateMachine';
import { hasFreshPremiumAccessIntent } from './premiumAccessIntent';

/**
 * @param {object} snapshot
 * @returns {'inactive' | 'expired' | null}
 */
export function resolvePremiumAccessPromptVariant(snapshot) {
  const phase = snapshot?.entitlementPhase;
  if (phase === 'EXPIRED') return 'expired';
  if (phase === 'INACTIVE') return 'inactive';
  return null;
}

/**
 * @param {object} snapshot
 * @returns {boolean}
 */
export function mayShowPremiumAccessPrompt(snapshot) {
  if (!hasFreshPremiumAccessIntent()) return false;
  const phase = snapshot?.entitlementPhase;
  return mayOpenPaymentPopup(phase);
}
