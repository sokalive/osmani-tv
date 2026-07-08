/**
 * Direct HLS player type — bare manifest URLs without stream-proxy or synthetic headers.
 *
 * Admin playerType: direct_hls (display: "Direct HLS")
 * Uses native Exo via expo-av; no WebView, no Referer/Origin/User-Agent unless configured on channel.
 */

import { normalizePlayerType } from './channelStream';
import { resolveMediaAssetUrl } from './mediaDelivery';

export const DIRECT_HLS_PLAYER_TYPE = 'direct_hls';

/**
 * @param {unknown} pt
 * @returns {boolean}
 */
export function isDirectHlsPlayerType(pt) {
  return normalizePlayerType(pt) === DIRECT_HLS_PLAYER_TYPE;
}

/**
 * Manifest URL for direct_hls — exact upstream path/query preserved.
 * Legacy admin API host rewrite only; external CDN URLs are unchanged.
 *
 * @param {unknown} uri
 * @returns {string}
 */
export function resolveDirectHlsManifestUrl(uri) {
  const s = String(uri ?? '').trim();
  if (!s) return '';
  return resolveMediaAssetUrl(s);
}

/**
 * Optional request headers — only when explicitly set on the channel row.
 *
 * @param {Record<string, unknown> | null | undefined} channel
 * @returns {Record<string, string> | undefined}
 */
export function buildDirectHlsStreamHeaders(channel) {
  if (!channel || typeof channel !== 'object') return undefined;
  const headers = {};
  const referer = typeof channel.referer === 'string' ? channel.referer.trim() : '';
  const origin = typeof channel.origin === 'string' ? channel.origin.trim() : '';
  const userAgent =
    typeof channel.userAgent === 'string'
      ? channel.userAgent.trim()
      : typeof channel.user_agent === 'string'
        ? channel.user_agent.trim()
        : '';
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  if (userAgent) headers['User-Agent'] = userAgent;
  return Object.keys(headers).length ? headers : undefined;
}

/**
 * Backup stream URL for direct_hls — no stream-proxy wrap.
 *
 * @param {unknown} rawBackup
 * @returns {string}
 */
export function resolveDirectHlsBackupUrl(rawBackup) {
  const s = String(rawBackup ?? '').trim();
  if (!s) return '';
  return resolveMediaAssetUrl(s);
}
