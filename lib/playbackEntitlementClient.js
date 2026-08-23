/**
 * Client helpers for server-side premium entitlement (catalog + streams).
 * Does not implement payment or change subscription activation.
 */

export const SUBSCRIPTION_DENY_REASONS = Object.freeze([
  'no_active_subscription',
  'subscription_expired',
  'subscription_inactive',
  'subscription_revoked',
  'missing_device_id',
]);

/**
 * @param {unknown} reason
 */
export function isSubscriptionEntitlementDenyReason(reason) {
  const r = String(reason ?? '').trim();
  return SUBSCRIPTION_DENY_REASONS.includes(r);
}

/**
 * @param {Record<string, unknown> | null | undefined} raw
 */
export function channelAccessDeniedByServer(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.access_denied === true) return true;
  if (raw.playback_authorized === false) return true;
  const reason = String(raw.access_deny_reason ?? '').trim();
  return Boolean(reason);
}

/**
 * When the server redacts premium URLs, do not treat leftover proxy_fallback as entitlement.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeCatalogChannelForClient(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const accessType = String(raw.accessType ?? raw.access_type ?? '').toLowerCase();
  const isPremium =
    accessType === 'premium' ||
    raw.accessPremium === true ||
    raw.access_premium === true;
  if (!isPremium) return raw;
  if (!channelAccessDeniedByServer(raw)) {
    // Still require a real primary URL; empty + only fallback is not authorization.
    const primary = String(
      raw.playbackUrl || raw.playback_url || raw.url || raw.stream_url || raw.streamUrl || '',
    ).trim();
    if (primary) return raw;
  }
  return {
    ...raw,
    url: '',
    playbackUrl: '',
    playback_url: '',
    stream_url: '',
    streamUrl: '',
    proxy_playback_url: '',
    proxyPlaybackUrl: '',
    proxy_fallback_url: '',
    proxyFallbackUrl: '',
    direct_stream_url: '',
    directStreamUrl: '',
    backupStream1: '',
    backup_stream_1: '',
    backupStream2: '',
    backup_stream_2: '',
    backupPlayback1: '',
    backupPlayback2: '',
    direct_stream_url_backup1: '',
    direct_stream_url_backup2: '',
    access_denied: true,
    playback_authorized: false,
    access_deny_reason:
      raw.access_deny_reason ||
      (channelAccessDeniedByServer(raw) ? raw.access_deny_reason : 'no_active_subscription'),
  };
}

/**
 * Attach device_id / playback_grant to stream-proxy or stream-direct URLs.
 * @param {string} url
 * @param {{ deviceId?: string | null; grant?: string | null }} [opts]
 */
export function attachStreamEntitlementParams(url, opts = {}) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  const deviceId = String(opts.deviceId ?? '').trim();
  const grant = String(opts.grant ?? '').trim();
  if (!deviceId && !grant) return raw;
  if (!/\/stream-proxy(?:\?|$)/i.test(raw) && !/\/stream-direct(?:\?|$)/i.test(raw)) {
    return raw;
  }
  try {
    const u = new URL(raw);
    if (deviceId && !u.searchParams.get('device_id')) {
      u.searchParams.set('device_id', deviceId);
    }
    if (grant) {
      u.searchParams.set('playback_grant', grant);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Device identity headers accepted by the live Contabo entitlement gate.
 * @param {string} deviceId
 */
export function deviceIdentityHeaders(deviceId) {
  const id = String(deviceId ?? '').trim();
  if (!id) return {};
  return {
    'X-Device-Id': id,
    'X-Osmani-Device-Id': id,
  };
}
