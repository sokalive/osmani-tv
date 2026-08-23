import {
  isStreamProxyUrl,
  resolveMediaAssetUrl,
  resolveStreamProxyBase,
} from './mediaDelivery';
import { attachStreamEntitlementParams } from './playbackEntitlementClient';
import { getFreshPlaybackGrant } from './playbackGrantSession';

/**
 * Resolves the stream-proxy base.
 *
 * Priority:
 *   1. EXPO_PUBLIC_STREAM_PROXY_URL (e.g. "https://osmanitv.b-cdn.net/stream-proxy")
 *   2. `${MEDIA_CDN}/stream-proxy` (default BunnyCDN)
 */
export const STREAM_PROXY_BASE = resolveStreamProxyBase();

/**
 * Build a tokenized-IPTV-safe proxy URL for an HLS manifest.
 *
 * The proxy is responsible for forwarding Referer / Origin / User-Agent on the
 * upstream request and for rewriting variant/segment URLs (so subsequent .ts
 * fetches also flow through the same proxy).
 *
 * Convention used by the app:
 *   {PROXY_BASE}?url=<encoded m3u8>&referer=<encoded>&origin=<encoded>&ua=<encoded>
 *
 * Empty header values are omitted.
 * When deviceId/grant are available they are attached for Contabo entitlement.
 *
 * @param {string} streamUrl
 * @param {{ referer?: string, origin?: string, userAgent?: string, deviceId?: string, grant?: string }} [headers]
 */
export function buildHlsProxyUrl(streamUrl, headers = {}) {
  const u = String(streamUrl ?? '').trim();
  if (!u) return '';
  if (isStreamProxyUrl(u)) {
    return attachStreamEntitlementParams(resolveMediaAssetUrl(u), {
      deviceId: headers?.deviceId,
      grant: headers?.grant,
    });
  }
  const params = new URLSearchParams();
  params.set('url', u);
  if (headers?.referer) params.set('referer', String(headers.referer));
  if (headers?.origin) params.set('origin', String(headers.origin));
  if (headers?.userAgent) params.set('ua', String(headers.userAgent));
  const grantSession = getFreshPlaybackGrant();
  const deviceId = String(headers?.deviceId || grantSession?.deviceId || '').trim();
  const grant = String(headers?.grant || grantSession?.grant || '').trim();
  if (deviceId) params.set('device_id', deviceId);
  if (grant) params.set('playback_grant', grant);
  return `${STREAM_PROXY_BASE}?${params.toString()}`;
}
