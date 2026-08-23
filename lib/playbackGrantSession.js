/**
 * Short-lived in-memory playback grant from POST /api/playback/authorize.
 * Not a client premium flag — discarded when expired or denied.
 */

/** @type {{
 *   grant: string | null;
 *   expiresAtMs: number;
 *   deviceId: string;
 *   channelId: string;
 * }} */
let session = {
  grant: null,
  expiresAtMs: 0,
  deviceId: '',
  channelId: '',
};

/**
 * @param {{
 *   grant?: string | null;
 *   expiresAt?: string | number | null;
 *   ttlSec?: number | null;
 *   deviceId?: string | null;
 *   channelId?: string | number | null;
 * }} input
 */
export function setPlaybackGrantSession(input = {}) {
  const grant = typeof input.grant === 'string' && input.grant.trim() ? input.grant.trim() : null;
  if (!grant) {
    clearPlaybackGrantSession();
    return;
  }
  let expiresAtMs = 0;
  if (input.expiresAt != null && String(input.expiresAt).trim()) {
    const t = Date.parse(String(input.expiresAt));
    if (Number.isFinite(t)) expiresAtMs = t;
  }
  if (!expiresAtMs && Number.isFinite(Number(input.ttlSec))) {
    expiresAtMs = Date.now() + Math.max(30, Number(input.ttlSec)) * 1000;
  }
  if (!expiresAtMs) {
    expiresAtMs = Date.now() + 180_000;
  }
  session = {
    grant,
    expiresAtMs,
    deviceId: String(input.deviceId ?? '').trim(),
    channelId: input.channelId != null ? String(input.channelId).trim() : '',
  };
}

export function clearPlaybackGrantSession() {
  session = { grant: null, expiresAtMs: 0, deviceId: '', channelId: '' };
}

/**
 * @param {{ channelId?: string | number | null; skewMs?: number }} [opts]
 */
export function getFreshPlaybackGrant(opts = {}) {
  const skewMs = Number.isFinite(opts.skewMs) ? opts.skewMs : 5_000;
  if (!session.grant || !session.expiresAtMs) return null;
  if (Date.now() + skewMs >= session.expiresAtMs) {
    clearPlaybackGrantSession();
    return null;
  }
  if (opts.channelId != null && session.channelId) {
    if (String(opts.channelId) !== session.channelId) {
      // Channel-bound grant must match; otherwise omit grant (device_id still used).
      return {
        grant: null,
        deviceId: session.deviceId,
        channelId: session.channelId,
        expiresAtMs: session.expiresAtMs,
      };
    }
  }
  return {
    grant: session.grant,
    deviceId: session.deviceId,
    channelId: session.channelId,
    expiresAtMs: session.expiresAtMs,
  };
}
