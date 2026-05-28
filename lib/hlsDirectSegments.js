/**
 * Direct HLS segment playback — unwrap /stream-proxy URLs so .ts/.m4s fetch
 * origin/CDN directly instead of piping video bytes through the proxy.
 */

import { devLog } from './devLog';
import {
  isStreamProxyUrl,
  resolveMediaAssetUrl,
} from './mediaDelivery';
import { normalizeStreamDeliveryMode } from './streamDelivery';

/** HTTP statuses that often indicate an expired signed URL. */
const TOKEN_EXPIRY_STATUSES = new Set([401, 403]);

/**
 * @param {unknown} deliveryMode
 * @param {boolean} [forceProxy]
 * @returns {boolean}
 */
export function shouldUseDirectHlsSegments(deliveryMode, forceProxy = false) {
  if (forceProxy) return false;
  const mode = normalizeStreamDeliveryMode(deliveryMode);
  return mode === 'direct' || mode === 'auto';
}

/**
 * @param {unknown} status
 * @returns {boolean}
 */
export function isLikelyTokenExpiryStatus(status) {
  const code = Number(status);
  return TOKEN_EXPIRY_STATUSES.has(code);
}

/**
 * Extract upstream URL from a stream-proxy wrapper (Render or Bunny CDN).
 *
 * @param {unknown} input
 * @returns {string}
 */
export function unwrapStreamProxyUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (!isStreamProxyUrl(s)) {
    return resolveMediaAssetUrl(s);
  }
  try {
    const u = new URL(s);
    const inner = u.searchParams.get('url');
    if (inner) {
      const decoded = decodeURIComponent(inner);
      return resolveMediaAssetUrl(decoded);
    }
  } catch {
    /* ignore */
  }
  return resolveMediaAssetUrl(s);
}

/**
 * Resolve a playlist line (absolute or relative to manifest base).
 *
 * @param {string} lineUrl
 * @param {string} manifestBaseUrl
 * @returns {string}
 */
export function resolvePlaylistLineUrl(lineUrl, manifestBaseUrl) {
  const raw = String(lineUrl ?? '').trim();
  if (!raw) return '';
  let abs = raw;
  if (!/^https?:\/\//i.test(raw)) {
    try {
      abs = new URL(raw, manifestBaseUrl).toString();
    } catch {
      abs = raw;
    }
  }
  return unwrapStreamProxyUrl(abs);
}

/**
 * Rewrite m3u8 text so segment / variant / key URIs bypass stream-proxy.
 *
 * @param {string} manifestText
 * @param {string} manifestBaseUrl
 * @returns {string}
 */
export function rewriteHlsManifestForDirectSegments(manifestText, manifestBaseUrl) {
  const base = String(manifestBaseUrl ?? '').trim();
  return String(manifestText ?? '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
          const resolved = resolvePlaylistLineUrl(uri, base);
          return resolved ? `URI="${resolved}"` : `URI="${uri}"`;
        });
      }
      return resolvePlaylistLineUrl(trimmed, base);
    })
    .join('\n');
}

/**
 * @param {string} manifestText
 * @returns {string | null}
 */
export function manifestTextToDataUri(manifestText) {
  const text = String(manifestText ?? '');
  if (!text) return null;
  try {
    if (typeof globalThis.Buffer !== 'undefined') {
      const b64 = globalThis.Buffer.from(text, 'utf8').toString('base64');
      return `data:application/vnd.apple.mpegurl;base64,${b64}`;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof globalThis.btoa === 'function') {
      const b64 = globalThis.btoa(
        unescape(encodeURIComponent(text)),
      );
      return `data:application/vnd.apple.mpegurl;base64,${b64}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Fetch manifest, unwrap proxy segment URLs, return a data: URI for native Exo when small enough.
 *
 * @param {string} manifestUrl
 * @param {Record<string, string>} [headers]
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<{ uri: string; rewritten: boolean; tokenExpired?: boolean }>}
 */
export async function prepareNativeDirectHlsManifest(
  manifestUrl,
  headers = {},
  opts = {},
) {
  const url = String(manifestUrl ?? '').trim();
  const maxBytes = opts.maxBytes ?? 256_000;
  if (!url) return { uri: '', rewritten: false };

  const h = {};
  if (headers.Referer) h.Referer = headers.Referer;
  if (headers.Origin) h.Origin = headers.Origin;
  if (headers['User-Agent']) h['User-Agent'] = headers['User-Agent'];

  let res;
  try {
    res = await fetch(url, { headers: h });
  } catch (e) {
    devLog('[hls-direct] manifest_fetch_error', e?.message ?? e);
    return { uri: url, rewritten: false };
  }

  if (isLikelyTokenExpiryStatus(res.status)) {
    return { uri: url, rewritten: false, tokenExpired: true };
  }

  if (!res.ok) {
    return { uri: url, rewritten: false };
  }

  const text = await res.text();
  if (text.length > maxBytes) {
    devLog('[hls-direct] manifest_too_large_for_data_uri', { bytes: text.length });
    return { uri: url, rewritten: false };
  }

  const rewritten = rewriteHlsManifestForDirectSegments(text, url);
  const dataUri = manifestTextToDataUri(rewritten);
  if (!dataUri) {
    return { uri: url, rewritten: false };
  }

  return { uri: dataUri, rewritten: true };
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [data]
 */
export function logSegmentDiagnostics(tag, data = {}) {
  devLog('[hls-segment]', tag, data);
}
