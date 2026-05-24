import {
  isStreamProxyUrl,
  resolveMediaAssetUrl,
} from './mediaDelivery';
import { buildHlsProxyUrl } from './streamProxy';

/** @param {unknown} url */
export function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

/**
 * @param {unknown} uri
 * @returns {string}
 */
export function extractProxiedUpstreamUrl(uri) {
  if (!isStreamProxyUrl(uri)) return '';
  try {
    return String(new URL(String(uri)).searchParams.get('url') ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * True when playback should use HLS manifest + stream-proxy (native / hls.js).
 * @param {unknown} uri
 */
export function looksLikeHlsPlaybackUri(uri) {
  const s = String(uri ?? '').trim();
  if (!s) return false;
  if (looksLikeHlsUrl(s)) return true;
  if (isStreamProxyUrl(s)) {
    const inner = extractProxiedUpstreamUrl(s);
    if (inner && looksLikeHlsUrl(inner)) return true;
    return looksLikeHlsUrl(decodeURIComponent(s));
  }
  return false;
}

/**
 * @param {{ referer?: string, origin?: string, userAgent?: string }} headers
 */
function headerBag(headers = {}) {
  return {
    referer: headers.referer ?? headers.Referer ?? '',
    origin: headers.origin ?? headers.Origin ?? '',
    userAgent: headers.userAgent ?? headers.user_agent ?? headers['User-Agent'] ?? '',
  };
}

/**
 * Resolve the final HLS manifest URL routed through BunnyCDN stream-proxy.
 * @param {unknown} uri
 * @param {{ referer?: string, origin?: string, userAgent?: string }} [headers]
 * @returns {string}
 */
export function resolveHlsProxiedManifestUrl(uri, headers = {}) {
  const s = String(uri ?? '').trim();
  if (!s) return '';
  if (isStreamProxyUrl(s)) {
    return resolveMediaAssetUrl(s);
  }
  if (!looksLikeHlsUrl(s)) return '';
  return buildHlsProxyUrl(s, headerBag(headers));
}

/**
 * Pick the primary playback URL for a catalog row (CDN-first, backward compatible).
 *
 * @param {{
 *   rawUrl?: string,
 *   playbackUrl?: string,
 *   streamProxyPrimary?: string,
 *   referer?: string,
 *   origin?: string,
 *   userAgent?: string,
 * }} input
 * @returns {string}
 */
export function resolveChannelPrimaryPlaybackUrl(input = {}) {
  const rawUrl = String(input.rawUrl ?? '').trim();
  const playbackUrl = String(input.playbackUrl ?? '').trim();
  const streamProxyPrimary = String(input.streamProxyPrimary ?? '').trim();
  const headers = headerBag(input);

  if (playbackUrl) {
    return resolveMediaAssetUrl(playbackUrl);
  }
  if (isStreamProxyUrl(streamProxyPrimary)) {
    return resolveMediaAssetUrl(streamProxyPrimary);
  }
  if (rawUrl && looksLikeHlsUrl(rawUrl)) {
    return buildHlsProxyUrl(rawUrl, headers);
  }
  return rawUrl;
}

/**
 * @param {string} rawBackup
 * @param {{ referer?: string, origin?: string, userAgent?: string }} headers
 * @returns {string}
 */
export function resolveChannelBackupPlaybackUrl(rawBackup, headers = {}) {
  const s = String(rawBackup ?? '').trim();
  if (!s) return '';
  if (isStreamProxyUrl(s)) {
    return resolveMediaAssetUrl(s);
  }
  if (looksLikeHlsUrl(s)) {
    return buildHlsProxyUrl(s, headerBag(headers));
  }
  return s;
}
