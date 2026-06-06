import { isStreamProxyUrl } from './mediaDelivery';

/** @param {unknown} url */
function looksLikeHlsPath(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

/**
 * Decode a base64url JSON segment from a stream-direct token.
 *
 * @param {string} part
 * @returns {Record<string, unknown> | null}
 */
function decodeStreamDirectTokenPart(part) {
  try {
    let b64 = String(part ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    b64 += pad;
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : typeof Buffer !== 'undefined'
          ? Buffer.from(b64, 'base64').toString('utf8')
          : '';
    if (!json) return null;
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} url
 * @returns {Record<string, unknown> | null}
 */
function decodeStreamDirectTokenPayload(url) {
  try {
    const s = String(url ?? '').trim();
    if (!/\/stream-direct(?:\?|$)/i.test(s)) return null;
    const token = new URL(s).searchParams.get('token');
    if (!token) return null;
    for (const part of token.split('.')) {
      const payload = decodeStreamDirectTokenPart(part);
      if (payload && (payload.u != null || payload.url != null || payload.o != null)) {
        return payload;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decode upstream URL from a signed /stream-direct?token= payload (`u` field).
 *
 * @param {unknown} url
 * @returns {string}
 */
export function extractStreamDirectUpstreamUrl(url) {
  const payload = decodeStreamDirectTokenPayload(url);
  if (!payload) return '';
  return String(payload.u ?? payload.url ?? '').trim();
}

/**
 * Decode upstream origin hint from /stream-direct token (`o` field).
 *
 * @param {unknown} url
 * @returns {string}
 */
export function extractStreamDirectOrigin(url) {
  const payload = decodeStreamDirectTokenPayload(url);
  if (!payload) return '';
  return String(payload.o ?? payload.origin ?? '').trim();
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
 * Unwrap stream-proxy / stream-direct wrappers to the upstream URL for embed detection.
 *
 * @param {unknown} url
 * @returns {string}
 */
export function unwrapPlaybackUrlForEmbedCheck(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  const fromProxy = extractProxiedUpstreamUrl(s);
  if (fromProxy) return fromProxy;
  const fromDirect = extractStreamDirectUpstreamUrl(s);
  if (fromDirect) return fromDirect;
  return s;
}

/**
 * Provider HTML embed pages (player.php, iframe players) — including when wrapped by proxy/direct.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isProviderEmbedPageUrl(url) {
  const inner = unwrapPlaybackUrlForEmbedCheck(url);
  if (!inner || looksLikeHlsPath(inner)) return false;
  const path = inner.split(/[#?]/)[0].toLowerCase();
  if (/\.(?:mp4|ts|m2ts|mts)$/i.test(path)) return false;
  return /player\.php|\/player\/|\/embed(?:\/|$|\?)/i.test(inner);
}

/**
 * Absolute upstream embed page URL for WebView (never stream-proxy / stream-direct).
 *
 * @param {unknown} url
 * @returns {string}
 */
export function resolveProviderEmbedPageUrl(url) {
  if (!isProviderEmbedPageUrl(url)) return '';
  const inner = unwrapPlaybackUrlForEmbedCheck(url);
  if (!inner) return '';
  if (/^https?:\/\//i.test(inner)) return inner;
  if (inner.startsWith('/')) {
    const origin = extractStreamDirectOrigin(url);
    if (origin) {
      try {
        return new URL(inner, origin.endsWith('/') ? origin : `${origin}/`).toString();
      } catch {
        return '';
      }
    }
  }
  return '';
}
