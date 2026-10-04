/**
 * EXO + HTTP cleartext bridge — prefer backend HTTPS playbackUrl (stream-proxy).
 *
 * When Admin URL is HTTP and playerType is EXO, the backend exposes an HTTPS
 * /stream-proxy playbackUrl. ExoPlayer must never receive the raw HTTP source
 * when that proxy URL is present (Play cleartext blocked).
 */

import { normalizePlayerType } from './channelStream';
import { isStreamProxyUrl, resolveMediaAssetUrl } from './mediaDelivery';

/**
 * @param {unknown} url
 * @returns {boolean}
 */
export function isCleartextHttpUrl(url) {
  return /^http:\/\//i.test(String(url ?? '').trim());
}

/**
 * Valid backend playback URL for EXO: absolute HTTPS (typically /stream-proxy).
 * @param {unknown} url
 * @returns {boolean}
 */
export function isValidBackendPlaybackUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return false;
  if (!/^https:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * @param {unknown} url
 * @returns {boolean}
 */
export function isStreamProxyPlaybackUrl(url) {
  return isStreamProxyUrl(url) && isValidBackendPlaybackUrl(url);
}

/** @param {unknown} url */
function looksLikeHlsPath(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

/**
 * Upstream inside /stream-proxy?url=...
 * @param {unknown} proxyUrl
 * @returns {string}
 */
function extractProxyUpstream(proxyUrl) {
  if (!isStreamProxyUrl(proxyUrl)) return '';
  try {
    return String(new URL(String(proxyUrl)).searchParams.get('url') ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * True when backend playbackUrl is an EXO-capable HLS proxy (not player.php embed).
 * @param {unknown} playbackUrl
 * @returns {boolean}
 */
export function isExoCapableProxyPlaybackUrl(playbackUrl) {
  if (!isStreamProxyPlaybackUrl(playbackUrl)) return false;
  const inner = extractProxyUpstream(playbackUrl);
  if (!inner) return false;
  return looksLikeHlsPath(inner);
}

/**
 * For EXO + HTTP (or HLS) sources: prefer backend HTTPS stream-proxy playbackUrl.
 * Does NOT hijack player.php / embed channels.
 *
 * @param {{
 *   playerType?: unknown,
 *   rawUrl?: string,
 *   playbackUrl?: string,
 *   proxyFallbackUrl?: string,
 *   proxyPlaybackUrl?: string,
 * }} input
 * @returns {{
 *   playUrl: string,
 *   proxyFallbackUrl: string,
 *   deliveryMode: 'proxy',
 *   streamDeliveryMode: 'proxy',
 *   isStreamProxy: boolean,
 *   isCleartextHttp: boolean,
 *   playbackSource: 'proxy_cleartext_bridge' | 'proxy',
 * } | null}
 */
export function resolveExoBackendPlaybackPreference(input = {}) {
  const playerType = normalizePlayerType(input.playerType);
  if (playerType !== 'exo') return null;

  const rawUrl = String(input.rawUrl ?? '').trim();
  const candidates = [
    input.playbackUrl,
    input.proxyPlaybackUrl,
    input.proxyFallbackUrl,
  ];
  let chosen = '';
  for (const c of candidates) {
    const s = String(c ?? '').trim();
    if (isExoCapableProxyPlaybackUrl(s)) {
      chosen = resolveMediaAssetUrl(s);
      break;
    }
  }
  if (!chosen) return null;

  // Apply when raw is cleartext HTTP, or raw itself is HLS (proxy preferred for EXO).
  const rawIsCleartext = isCleartextHttpUrl(rawUrl);
  const rawIsHls = looksLikeHlsPath(rawUrl);
  if (!rawIsCleartext && !rawIsHls) return null;

  return {
    playUrl: chosen,
    proxyFallbackUrl: chosen,
    deliveryMode: 'proxy',
    streamDeliveryMode: 'proxy',
    isStreamProxy: true,
    isCleartextHttp: false,
    playbackSource: rawIsCleartext ? 'proxy_cleartext_bridge' : 'proxy',
  };
}

/**
 * Safety net: never hand cleartext HTTP to Exo when a HTTPS proxy fallback exists.
 *
 * @param {string} uri
 * @param {string} [proxyFallbackUrl]
 * @returns {string}
 */
export function guardExoManifestAgainstCleartext(uri, proxyFallbackUrl = '') {
  const u = String(uri ?? '').trim();
  const proxy = String(proxyFallbackUrl ?? '').trim();
  if (!u) return '';
  if (isCleartextHttpUrl(u) && isValidBackendPlaybackUrl(proxy)) {
    return resolveMediaAssetUrl(proxy);
  }
  if (isCleartextHttpUrl(u) && isStreamProxyUrl(u) === false) {
    // Last resort: if somehow only cleartext remains, still surface it —
    // caller/logging decides. Prefer not inventing a proxy without base URL.
    return u;
  }
  return u;
}
