export const ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_TITLE = 'Kifurushi Kinaendelea';

export const ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE =
  'Kwasasa una kifurushi kinachoendelea.\n\n' +
  'Huwezi kulipia tena mpaka kifurushi chako kiishe.\n\n' +
  'Subiri mpaka kifurushi chako kiishe ndipo ulipie tena.\n\n' +
  'Asante.';

export const PAYMENT_ENTRY_VERIFY_ERROR_TITLE = 'Tafadhali Jaribu Tena';

export const PAYMENT_ENTRY_VERIFY_ERROR_MESSAGE =
  'Hatukuweza kuthibitisha hali ya kifurushi chako kwa sasa. Hakuna malipo yaliyoanzishwa. Tafadhali jaribu tena.';

/**
 * Fail closed: checkout is allowed only after an authoritative inactive
 * response. Cached/transport-preserved active state must still block payment.
 */
export function classifyPaymentEntrySubscription(result) {
  if (result?.active === true || result?.isActive === true) return 'active';
  if (result?.error || result?.transportPreserved === true || result?.pendingPreserved === true) {
    return 'unknown';
  }
  const source = String(result?.resolveSource ?? '').toLowerCase();
  if (source.includes('transport') || source.includes('timeout') || source.includes('pending')) {
    return 'unknown';
  }
  return result && (result.active === false || result.isActive === false)
    ? 'inactive'
    : 'unknown';
}
