/**
 * Modal priority for channel update gate — higher-priority overlays block the gate.
 * Lower numeric rank = higher priority (shown first, blocks lower ranks).
 */

export const MODAL_PRIORITY = Object.freeze({
  MANDATORY_UPDATE_OVERLAY: 10,
  UPDATE_OVERLAY: 20,
  SUBSCRIPTION_REVOKED: 30,
  TRANSFER_CONFIRM: 40,
  TRANSFER_SUCCESS: 45,
  PAYMENT: 50,
  EMERGENCY: 60,
  DEVICE_INTELLIGENCE: 70,
  NOTIFICATION_REMINDER: 80,
  CATALOG_PREMIUM: 90,
  CHANNEL_UPDATE_GATE: 100,
});

/** Blocking sheet IDs registered via ModalSheetCoordinator (exact or prefix). */
const EXACT_BLOCKING_SHEET_IDS = new Set([
  'lifecycle-revoked',
  'lifecycle-transfer',
  'lifecycle-plans',
  'global-payment-modal',
  'global-emergency',
  'device-intelligence-blocked',
  'device-intelligence-unblocked',
  'notification-permission-reminder',
  'update-overlay',
]);

const BLOCKING_SHEET_PREFIXES = ['catalog-premium-', 'catalog-manual-gift-'];

/**
 * @param {string} sheetId
 * @returns {boolean}
 */
export function isHigherPriorityBlockingSheet(sheetId) {
  const id = String(sheetId ?? '').trim();
  if (!id) return false;
  if (EXACT_BLOCKING_SHEET_IDS.has(id)) return true;
  return BLOCKING_SHEET_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/**
 * @param {string[]} blockingSheetIds
 * @returns {boolean}
 */
export function hasHigherPriorityBlockingSheet(blockingSheetIds) {
  const ids = Array.isArray(blockingSheetIds) ? blockingSheetIds : [];
  return ids.some(isHigherPriorityBlockingSheet);
}

/**
 * Whether the channel update gate must defer (not stack on top of critical UI).
 *
 * @param {{
 *   mandatoryUpdateOverlayActive?: boolean;
 *   updateOverlayVisible?: boolean;
 *   blockingSheetIds?: string[];
 *   channelUpdateGateVisible?: boolean;
 *   sourceTransferSuccessVisible?: boolean;
 * }} opts
 * @returns {{ defer: boolean; reason: string|null }}
 */
export function evaluateChannelUpdateGatePresentation(opts = {}) {
  if (opts.channelUpdateGateVisible) {
    return { defer: false, reason: 'already_visible' };
  }
  if (opts.mandatoryUpdateOverlayActive) {
    return { defer: true, reason: 'mandatory_update_overlay' };
  }
  if (opts.updateOverlayVisible) {
    return { defer: true, reason: 'update_overlay' };
  }
  if (opts.sourceTransferSuccessVisible) {
    return { defer: true, reason: 'transfer_success' };
  }
  if (hasHigherPriorityBlockingSheet(opts.blockingSheetIds)) {
    return { defer: true, reason: 'blocking_sheet' };
  }
  return { defer: false, reason: null };
}
