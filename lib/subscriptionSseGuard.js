/**
 * Guards subscription / transfer SSE handlers against global broadcasts.
 * Backend /api/sync/stream may emit transfer lifecycle events to all
 * connected clients — only act when payload device ids match this install.
 */

import { isSubscriptionTransportFailure } from '../api/subscription';
import { getDeviceIdentity } from './deviceIdentity';

function pickPayloadString(payload, keys) {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of keys) {
    const value = key
      .split('.')
      .reduce(
        (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
        payload,
      );
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

/** Unwrap `{ event, payload }` admin SSE envelopes. */
export function unwrapSubscriptionSsePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.payload && typeof payload.payload === 'object') return payload.payload;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function normalizeDeviceId(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** @returns {Promise<Set<string>>} */
export async function currentDeviceIdSet() {
  const identity = await getDeviceIdentity();
  const ids = new Set();
  const add = (v) => {
    const n = normalizeDeviceId(v);
    if (n) ids.add(n);
  };
  add(identity.deviceId);
  add(identity.subscriptionDeviceId);
  add(identity.androidId);
  add(identity.legacyPackageAndroidId);
  add(identity.packageAndroidId);
  add(identity.displayedAccountId);
  if (Array.isArray(identity.identityCandidates)) {
    for (const c of identity.identityCandidates) {
      add(c?.deviceId);
    }
  }
  return ids;
}

/**
 * Which side of a transfer lifecycle event this install is on.
 * @returns {Promise<'source'|'target'|'device'|'none'|'other'>}
 */
export async function subscriptionTransferSseRole(payload, eventName = '') {
  const inner = unwrapSubscriptionSsePayload(payload);
  if (!inner || typeof inner !== 'object') return 'none';

  const ids = await currentDeviceIdSet();
  const matches = (raw) => {
    const n = normalizeDeviceId(raw);
    return Boolean(n && ids.has(n));
  };

  const source = pickPayloadString(inner, [
    'source_device_id',
    'sourceDeviceId',
    'source_device.device_id',
    'source_device.id',
    'from_device_id',
    'fromDeviceId',
  ]);
  const target = pickPayloadString(inner, [
    'target_device_id',
    'targetDeviceId',
    'target_device.device_id',
    'target_device.id',
    'to_device_id',
    'toDeviceId',
  ]);
  const device = pickPayloadString(inner, [
    'device_id',
    'deviceId',
    'lost_device_id',
    'lostDeviceId',
    'previous_device_id',
    'previousDeviceId',
    'revoked_device_id',
    'revokedDeviceId',
  ]);

  const hasAnyId = Boolean(source || target || device);
  if (!hasAnyId) {
    console.log('[SUBSCRIPTION_SSE_GUARD]', 'ignored_no_device_ids', { eventName });
    return 'none';
  }

  if (source && matches(source)) return 'source';
  if (target && matches(target)) return 'target';
  if (device && matches(device)) return 'device';

  console.log('[SUBSCRIPTION_SSE_GUARD]', 'ignored_other_device', {
    eventName,
    source: source ? `${source.slice(0, 8)}…` : null,
    target: target ? `${target.slice(0, 8)}…` : null,
    device: device ? `${device.slice(0, 8)}…` : null,
  });
  return 'other';
}

/** True only when verify confirms backend says inactive (not transport glitch). */
export function isConfirmedSubscriptionLoss(verifyResult) {
  if (!verifyResult || verifyResult.active === true) return false;
  if (verifyResult.transportPreserved === true) return false;
  if (isSubscriptionTransportFailure(verifyResult)) return false;
  const src = String(verifyResult.resolveSource ?? '');
  if (src.startsWith('transport:')) return false;
  return src === 'inactive';
}

function pickFromVerifyObject(verifyResult, keys) {
  if (!verifyResult || typeof verifyResult !== 'object') return null;
  for (const key of keys) {
    const direct = verifyResult[key];
    if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  }
  const raw = verifyResult.raw;
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : null;
  const sub = raw.subscription && typeof raw.subscription === 'object' ? raw.subscription : null;
  for (const key of keys) {
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const candidates = [raw[key], raw[snake], data?.[key], data?.[snake], sub?.[key], sub?.[snake]];
    for (const c of candidates) {
      if (c != null && String(c).trim() !== '') return String(c).trim();
    }
  }
  return null;
}

/**
 * Backend `inactiveReason` only — never infer from `code`, `reason`, or other fields.
 * @param {unknown} verifyResult
 * @returns {string|null}
 */
export function extractExplicitInactiveReason(verifyResult) {
  return pickFromVerifyObject(verifyResult, ['inactiveReason', 'inactive_reason']);
}

/**
 * Backend subscription `status` only — used for explicit revoked/suspended confirmation.
 * @param {unknown} verifyResult
 * @returns {string|null}
 */
export function extractExplicitInactiveStatus(verifyResult) {
  return pickFromVerifyObject(verifyResult, ['status']);
}

/**
 * Extract inactive reason from a normalized verify/recover result (diagnostics only).
 * @param {unknown} verifyResult
 * @returns {string|null}
 */
export function extractSubscriptionInactiveReason(verifyResult) {
  if (!verifyResult || typeof verifyResult !== 'object') return null;
  const direct = verifyResult.inactiveReason;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  const raw = verifyResult.raw;
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : null;
  const sub = raw.subscription && typeof raw.subscription === 'object' ? raw.subscription : null;
  const candidates = [
    raw.reason,
    raw.inactive_reason,
    raw.inactiveReason,
    raw.status,
    raw.code,
    data?.reason,
    data?.inactive_reason,
    data?.status,
    sub?.reason,
    sub?.status,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c).trim();
  }
  return null;
}

function normalizeLossToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Revoked modal only when backend explicitly reports inactiveReason or status = revoked.
 * @param {unknown} verifyResult
 */
export function isExplicitRevokedConfirmation(verifyResult) {
  const reason = normalizeLossToken(extractExplicitInactiveReason(verifyResult));
  const status = normalizeLossToken(extractExplicitInactiveStatus(verifyResult));
  return reason === 'revoked' || status === 'revoked';
}

/**
 * Suspended modal only when backend explicitly reports inactiveReason or status = suspended.
 * @param {unknown} verifyResult
 */
export function isExplicitSuspendedConfirmation(verifyResult) {
  const reason = normalizeLossToken(extractExplicitInactiveReason(verifyResult));
  const status = normalizeLossToken(extractExplicitInactiveStatus(verifyResult));
  return reason === 'suspended' || status === 'suspended';
}

/** @deprecated Use isExplicitRevokedConfirmation — kept for script mirrors. */
export function isExplicitRevokedInactiveReason(reason) {
  const t = normalizeLossToken(reason);
  return t === 'revoked';
}

/** @deprecated Use isExplicitSuspendedConfirmation */
export function isExplicitSuspendedInactiveReason(reason) {
  const t = normalizeLossToken(reason);
  return t === 'suspended';
}

/** @param {unknown} reason */
export function isExplicitExpiredInactiveReason(reason) {
  const t = String(reason ?? '').toLowerCase();
  if (!t) return false;
  return (
    t === 'expired' ||
    t.includes('expired') ||
    t.includes('lapsed') ||
    t.includes('imeisha') ||
    t.includes('muda wake')
  );
}

/**
 * Modal reason for TransferredAwayModal — never "revoked"/"suspended" unless backend
 * verify response explicitly reports those tokens on inactiveReason or status.
 *
 * @param {unknown} verifyResult
 * @returns {'revoked'|'suspended'|'expired'|null}
 */
export function resolveSubscriptionLossModalReason(verifyResult) {
  if (!isConfirmedSubscriptionLoss(verifyResult)) return null;
  if (isExplicitRevokedConfirmation(verifyResult)) return 'revoked';
  if (isExplicitSuspendedConfirmation(verifyResult)) return 'suspended';
  return 'expired';
}

/**
 * Structured diagnostic for subscription lifecycle modal decisions.
 * @param {string} trigger
 * @param {unknown} verifyResult
 * @param {'revoked'|'suspended'|'expired'|null|'cleared'|'skipped'} decision
 * @param {Record<string, unknown>} [extra]
 */
export function logSubscriptionLossModalDecision(trigger, verifyResult, decision, extra = {}) {
  console.log('[SUBSCRIPTION_LOSS_MODAL]', trigger, {
    decision,
    active: verifyResult?.active ?? null,
    resolveSource: verifyResult?.resolveSource ?? null,
    transportPreserved: verifyResult?.transportPreserved === true,
    inactiveReason: extractExplicitInactiveReason(verifyResult),
    status: extractExplicitInactiveStatus(verifyResult),
    inferredReason: extractSubscriptionInactiveReason(verifyResult),
    error: verifyResult?.error ?? null,
    confirmedLoss: isConfirmedSubscriptionLoss(verifyResult),
    explicitRevoked: isExplicitRevokedConfirmation(verifyResult),
    explicitSuspended: isExplicitSuspendedConfirmation(verifyResult),
    ...extra,
  });
}
