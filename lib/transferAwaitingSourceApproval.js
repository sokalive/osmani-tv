/**
 * When should the SOURCE device show KUBALI/KATAA (TransferConfirmModal)?
 *
 * Current VPS backend (325a5a9+) activates immediately on /transfer/confirm and
 * does not implement /transfer/respond. `transfer_requested` is emitted when a
 * code is *issued* (status often `active`) — that must NOT open approval UI.
 *
 * Forward-compatible: when Backend AI adds confirmation mode, payloads should
 * include `status: awaiting_confirmation` or `transfer_confirmation_required`.
 */

function pickString(payload, keys) {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of keys) {
    const v = payload[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * @param {unknown} payload
 * @param {string} [eventName]
 */
export function isTransferAwaitingSourceApproval(payload, eventName = '') {
  const inner =
    payload && typeof payload === 'object' && payload.payload && typeof payload.payload === 'object'
      ? payload.payload
      : payload;
  if (!inner || typeof inner !== 'object') return false;

  const ev = String(eventName || '').toLowerCase();
  if (ev === 'transfer_confirmation_required') return true;

  const status = pickString(inner, ['status', 'state', 'transfer_status', 'transferStatus']).toLowerCase();
  const awaitingStatuses = new Set([
    'pending',
    'awaiting_confirmation',
    'awaiting_approval',
    'awaiting_target_submission',
    'pending_confirmation',
    'needs_confirmation',
  ]);
  if (awaitingStatuses.has(status)) return true;

  if (inner.pending === true || inner.awaiting_confirmation === true || inner.requires_confirmation === true) {
    return true;
  }

  // Code issuance broadcast — not an approval gate.
  if (ev === 'transfer_requested' && (status === 'active' || status === 'requested' || status === 'completed')) {
    return false;
  }

  if (ev === 'transfer_pending') return true;

  return false;
}
