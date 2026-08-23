/**
 * Server-side premium playback authorization (Phase 2 FINAL).
 * POST /api/playback/authorize — server is the entitlement authority.
 * Client premium flags are NEVER sent and NEVER trusted.
 */

import { fetchAdminApiResponse } from '../lib/catalogApiFetch';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import {
  clearPlaybackGrantSession,
  setPlaybackGrantSession,
} from '../lib/playbackGrantSession';
import {
  isSubscriptionEntitlementDenyReason,
  SUBSCRIPTION_DENY_REASONS,
} from '../lib/playbackEntitlementClient';

/**
 * @param {unknown} parsed
 * @param {number} status
 */
export function parsePlaybackAuthorizeResponse(parsed, status) {
  const body = parsed && typeof parsed === 'object' ? parsed : {};
  const reason = String(body.reason ?? body.playback_gate_reason ?? body.error ?? '').trim();
  const allowed =
    status >= 200 &&
    status < 300 &&
    (body.allowed === true || body.ok === true || body.playbackAllowed === true);

  return {
    ok: allowed,
    allowed,
    reason: reason || (allowed ? 'active_subscription' : 'no_active_subscription'),
    playbackAllowed: body.playbackAllowed === true || allowed,
    playbackGateReason: String(body.playback_gate_reason ?? reason ?? ''),
    deviceId: body.device_id != null ? String(body.device_id) : null,
    expiresAt: body.expires_at ?? null,
    grant: typeof body.grant === 'string' && body.grant.trim() ? body.grant.trim() : null,
    grantExpiresAt: body.grant_expires_at ?? null,
    grantTtlSec: Number.isFinite(Number(body.grant_ttl_sec)) ? Number(body.grant_ttl_sec) : null,
    channel: body.channel && typeof body.channel === 'object' ? body.channel : null,
    status,
    subscriptionDeny: isSubscriptionEntitlementDenyReason(reason),
    securityDeny: reason === 'security_policy_denied',
  };
}

/**
 * Authorize premium playback for the stable device identity.
 * @param {{
 *   channelId?: string | number | null;
 *   deviceId?: string | null;
 * }} [opts]
 */
export async function authorizePremiumPlayback(opts = {}) {
  const identity = await getDeviceIdentity();
  const deviceId = String(opts.deviceId || identity.deviceId || '').trim();
  const channelId =
    opts.channelId != null && String(opts.channelId).trim()
      ? String(opts.channelId).trim()
      : null;

  if (!deviceId) {
    clearPlaybackGrantSession();
    return {
      ok: false,
      allowed: false,
      reason: 'missing_device_id',
      playbackAllowed: false,
      playbackGateReason: 'missing_device_id',
      deviceId: null,
      expiresAt: null,
      grant: null,
      grantExpiresAt: null,
      grantTtlSec: null,
      channel: null,
      status: 0,
      subscriptionDeny: true,
      securityDeny: false,
    };
  }

  const body = {
    device_id: deviceId,
  };
  if (channelId) body.channel_id = channelId;
  // Intentionally omit isPremium / premium / paid / subscriptionActive.

  const { res, parsed } = await fetchAdminApiResponse('/api/playback/authorize', {
    tag: 'playback-authorize',
    method: 'POST',
    body,
    headers: {
      'X-Device-Id': deviceId,
      'X-Osmani-Device-Id': deviceId,
    },
    timeoutMs: 10_000,
  });

  const out = parsePlaybackAuthorizeResponse(parsed, res.status);

  if (out.allowed && out.grant) {
    setPlaybackGrantSession({
      grant: out.grant,
      expiresAt: out.grantExpiresAt,
      ttlSec: out.grantTtlSec,
      deviceId,
      channelId,
    });
  } else if (!out.allowed) {
    clearPlaybackGrantSession();
  }

  console.log(
    '[playback-authorize]',
    JSON.stringify({
      status: res.status,
      allowed: out.allowed,
      reason: out.reason,
      channelId,
      hasGrant: Boolean(out.grant),
      hasChannel: Boolean(out.channel),
    }),
  );

  return out;
}

export { SUBSCRIPTION_DENY_REASONS, isSubscriptionEntitlementDenyReason };
