/**
 * Stream delivery modes for HLS/live playback (Phase 4).
 *
 * - proxy: CDN /stream-proxy manifest (default — backward compatible)
 * - direct: play direct_stream_url (signed CDN/origin) without proxy wrap
 * - auto | hybrid: try direct first; client falls back to proxy on failure
 *
 * No production cutover until admin sets stream_delivery_mode per channel.
 */

import { normalizePlayerType } from './channelStream';
import { devLog } from './devLog';
import {
  resolveProviderEmbedPageUrl,
} from './embedPlaybackUrl';
import {
  isCleartextHttpUrl,
  resolveExoBackendPlaybackPreference,
} from './exoPlaybackBridge';
import {
  isStreamProxyUrl,
  resolveMediaAssetUrl,
} from './mediaDelivery';
import { buildHlsProxyUrl } from './streamProxy';

/** @param {unknown} url */
function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

/**
 * Provider HTML embed pages (player.php, iframe players) — not HLS manifests.
 * Re-exported from embedPlaybackUrl (handles stream-proxy / stream-direct wrappers).
 */
export { isProviderEmbedPageUrl, resolveProviderEmbedPageUrl } from './embedPlaybackUrl';

/**
 * @param {StreamDeliveryMode} deliveryMode
 * @param {string} rawUrl
 * @param {string} playUrl
 * @param {string} proxyFallbackUrl
 * @param {string} directUrl
 */
function finalizePlaybackPlan(deliveryMode, rawUrl, playUrl, proxyFallbackUrl, directUrl) {
  const embedFromRaw = resolveProviderEmbedPageUrl(rawUrl);
  if (embedFromRaw) {
    return {
      deliveryMode,
      playUrl: embedFromRaw,
      proxyFallbackUrl,
      directUrl,
    };
  }
  return {
    deliveryMode,
    playUrl,
    proxyFallbackUrl,
    directUrl,
  };
}

/** @typedef {'proxy' | 'direct' | 'auto'} StreamDeliveryMode */

/**
 * @param {unknown} raw
 * @returns {StreamDeliveryMode}
 */
export function normalizeStreamDeliveryMode(raw) {
  const m = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (m === 'direct') return 'direct';
  if (m === 'auto' || m === 'hybrid') return 'auto';
  return 'proxy';
}

/**
 * @param {Record<string, unknown>} [raw]
 */
export function readStreamDeliveryFields(raw) {
  const deliveryMode = normalizeStreamDeliveryMode(
    raw?.stream_delivery_mode ?? raw?.streamDeliveryMode,
  );
  const directStreamUrl = String(
    raw?.direct_stream_url ?? raw?.directStreamUrl ?? '',
  ).trim();
  const proxyFallbackUrl = String(
    raw?.proxy_fallback_url ??
      raw?.proxyFallbackUrl ??
      raw?.playback_url ??
      raw?.playbackUrl ??
      '',
  ).trim();
  return { deliveryMode, directStreamUrl, proxyFallbackUrl };
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
 * Build CDN stream-proxy manifest URL (always proxy path).
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
export function resolveProxyPlaybackUrl(input = {}) {
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
  return rawUrl ? resolveMediaAssetUrl(rawUrl) : '';
}

/**
 * @param {{
 *   rawUrl?: string,
 *   directStreamUrl?: string,
 *   playbackUrl?: string,
 *   streamProxyPrimary?: string,
 *   proxyFallbackUrl?: string,
 *   proxyPlaybackUrl?: string,
 *   deliveryMode?: unknown,
 *   playerType?: unknown,
 *   referer?: string,
 *   origin?: string,
 *   userAgent?: string,
 * }} input
 * @returns {{
 *   deliveryMode: StreamDeliveryMode,
 *   playUrl: string,
 *   proxyFallbackUrl: string,
 *   directUrl: string,
 *   playbackSource?: string,
 *   isStreamProxy?: boolean,
 *   isCleartextHttp?: boolean,
 * }}
 */
export function resolveChannelPlaybackPlan(input = {}) {
  const deliveryMode = normalizeStreamDeliveryMode(input.deliveryMode);
  const rawUrl = String(input.rawUrl ?? '').trim();
  const directRaw = String(input.directStreamUrl ?? '').trim();
  const proxyFallbackUrl = resolveProxyPlaybackUrl({
    rawUrl,
    playbackUrl: input.proxyFallbackUrl || input.playbackUrl || input.proxyPlaybackUrl,
    streamProxyPrimary: input.streamProxyPrimary,
    referer: input.referer,
    origin: input.origin,
    userAgent: input.userAgent,
  });
  const directUrl = resolveMediaAssetUrl(directRaw || (deliveryMode === 'direct' ? rawUrl : ''));

  // EXO: backend HTTPS playbackUrl wins over raw HTTP / directStreamUrl.
  // Skip embed override — Exo must keep the proxy/HLS playUrl, not player.php.
  const exoPref = resolveExoBackendPlaybackPreference({
    playerType: input.playerType,
    rawUrl,
    playbackUrl: input.playbackUrl,
    proxyPlaybackUrl: input.proxyPlaybackUrl,
    proxyFallbackUrl: proxyFallbackUrl || input.proxyFallbackUrl,
  });
  if (exoPref) {
    return {
      deliveryMode: 'proxy',
      playUrl: exoPref.playUrl,
      proxyFallbackUrl: exoPref.proxyFallbackUrl,
      directUrl,
      playbackSource: exoPref.playbackSource,
      isStreamProxy: exoPref.isStreamProxy,
      isCleartextHttp: false,
    };
  }

  if (deliveryMode === 'proxy') {
    return finalizePlaybackPlan(
      deliveryMode,
      rawUrl,
      proxyFallbackUrl,
      proxyFallbackUrl,
      directUrl,
    );
  }

  if (deliveryMode === 'direct') {
    const playUrl = directUrl || rawUrl;
    return finalizePlaybackPlan(
      deliveryMode,
      rawUrl,
      playUrl,
      proxyFallbackUrl,
      playUrl,
    );
  }

  // auto / hybrid — direct when present, else proxy (no forced cutover)
  // Cleartext raw must not beat HTTPS proxy when proxyFallbackUrl exists.
  let playUrl = directUrl || proxyFallbackUrl;
  if (isCleartextHttpUrl(playUrl) && proxyFallbackUrl && !isCleartextHttpUrl(proxyFallbackUrl)) {
    playUrl = proxyFallbackUrl;
  }
  return finalizePlaybackPlan(deliveryMode, rawUrl, playUrl, proxyFallbackUrl, directUrl);
}

/**
 * Resolve the HLS manifest URL used by native player / hls.js WebView.
 *
 * @param {{
 *   uri: string,
 *   deliveryMode?: unknown,
 *   directStreamUrl?: string,
 *   proxyFallbackUrl?: string,
 *   forceProxy?: boolean,
 *   referer?: string,
 *   origin?: string,
 *   userAgent?: string,
 * }} opts
 * @returns {string}
 */
export function resolveHlsManifestForPlayback(opts = {}) {
  const uri = String(opts.uri ?? '').trim();
  if (!uri) return '';

  const mode = normalizeStreamDeliveryMode(opts.deliveryMode);
  const forceProxy = opts.forceProxy === true;
  const proxyFallback = String(opts.proxyFallbackUrl ?? '').trim();
  const directStreamUrl = String(opts.directStreamUrl ?? '').trim();
  const headers = headerBag(opts);
  const playerType = normalizePlayerType(opts.playerType);

  // EXO cleartext guard: never return http:// when HTTPS proxy fallback exists.
  const exoGuard = (candidate) => {
    if (playerType !== 'exo' && !isCleartextHttpUrl(candidate)) return candidate;
    if (isCleartextHttpUrl(candidate) && proxyFallback && !isCleartextHttpUrl(proxyFallback)) {
      return resolveMediaAssetUrl(proxyFallback);
    }
    if (
      playerType === 'exo' &&
      isCleartextHttpUrl(candidate) &&
      looksLikeHlsUrl(candidate)
    ) {
      // Build client-side HTTPS stream-proxy wrap as last resort.
      return buildHlsProxyUrl(candidate, headers);
    }
    return candidate;
  };

  if (forceProxy) {
    if (proxyFallback) return resolveMediaAssetUrl(proxyFallback);
    if (isStreamProxyUrl(uri)) return resolveMediaAssetUrl(uri);
    if (looksLikeHlsUrl(uri)) return buildHlsProxyUrl(uri, headers);
    return resolveMediaAssetUrl(uri);
  }

  if (mode === 'proxy') {
    if (isStreamProxyUrl(uri)) return resolveMediaAssetUrl(uri);
    if (looksLikeHlsUrl(uri)) return buildHlsProxyUrl(uri, headers);
    return exoGuard(resolveMediaAssetUrl(uri));
  }

  if (mode === 'direct') {
    const direct = resolveMediaAssetUrl(directStreamUrl || uri);
    if (direct) return exoGuard(direct);
    if (proxyFallback) return resolveMediaAssetUrl(proxyFallback);
    if (isStreamProxyUrl(uri)) return resolveMediaAssetUrl(uri);
    if (looksLikeHlsUrl(uri)) return buildHlsProxyUrl(uri, headers);
    return exoGuard(uri);
  }

  // auto: uri is already the direct-first play URL from catalog build
  if (isStreamProxyUrl(uri)) return resolveMediaAssetUrl(uri);
  if (looksLikeHlsUrl(uri)) {
    return exoGuard(resolveMediaAssetUrl(directStreamUrl || uri));
  }
  return exoGuard(resolveMediaAssetUrl(uri));
}

/**
 * Whether proxy fallback should be attempted before showing a hard error.
 *
 * @param {{
 *   deliveryMode?: unknown,
 *   proxyFallbackUrl?: string,
 *   uri?: string,
 *   forceProxy?: boolean,
 * }} opts
 * @returns {boolean}
 */
export function canFallbackToProxyPlayback(opts = {}) {
  if (opts.forceProxy === true) return false;
  const mode = normalizeStreamDeliveryMode(opts.deliveryMode);
  if (mode === 'proxy') return false;
  const proxy = String(opts.proxyFallbackUrl ?? '').trim();
  const uri = String(opts.uri ?? '').trim();
  if (!proxy || proxy === uri) return false;
  return true;
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [data]
 */
export function logPlaybackDiagnostics(tag, data = {}) {
  devLog('[playback]', tag, data);
}
