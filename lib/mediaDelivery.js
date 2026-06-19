/**
 * Media URL rewriting — API/SSE/stream-direct use {@link ./apiBaseUrl}.
 *
 * `/stream-proxy` defaults to `${resolveApiBaseUrl()}/stream-proxy` or EXPO_PUBLIC_STREAM_PROXY_URL.
 * Legacy Render / IP URLs in catalog JSON are rewritten to the active API host or BunnyCDN.
 * Optional BunnyCDN (`EXPO_PUBLIC_MEDIA_CDN_BASE`) still used for `/uploads` images when configured.
 */

import { resolveApiBaseUrl } from './apiBaseUrl';

export const DEFAULT_MEDIA_CDN_BASE = 'https://osmanitv.b-cdn.net';

/** Hosts that historically served API media from Render or legacy IP — rewrite away. */
export const LEGACY_MEDIA_HOSTS = Object.freeze([
  'osmani-admin-api.onrender.com',
  'osmani-tv.onrender.com',
  '144.91.117.90',
  'api.osmanitv.com',
]);

/** @returns {string} */
function adminApiHost() {
  try {
    return new URL(resolveApiBaseUrl()).host.toLowerCase();
  } catch {
    return 'api.osmanitv.com';
  }
}

/**
 * Admin API serves uploads on disk; the app loads images from BunnyCDN (HTTPS).
 * Direct Contabo /uploads URLs often 404 off-CDN.
 *
 * @param {string} host
 * @param {string} pathname
 */
function isAdminUploadPath(host, pathname) {
  const h = String(host ?? '').toLowerCase();
  const path = String(pathname ?? '');
  if (!path.startsWith('/uploads/')) return false;
  if (LEGACY_MEDIA_HOSTS.some((legacy) => h === legacy.toLowerCase())) return true;
  return h === adminApiHost();
}

/** @param {URL} u @param {URL} target */
function applyUrlOrigin(u, target) {
  u.protocol = target.protocol;
  u.hostname = target.hostname;
  u.port = target.port;
}

function readEnv(name) {
  try {
    const env = typeof process !== 'undefined' ? process.env : undefined;
    const v = env?.[name];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** @returns {string} */
export function resolveMediaCdnBase() {
  return (
    readEnv('EXPO_PUBLIC_MEDIA_CDN_BASE') ??
    readEnv('EXPO_PUBLIC_CDN_BASE') ??
    DEFAULT_MEDIA_CDN_BASE
  ).replace(/\/+$/, '');
}

/** @returns {string} */
export function resolveStreamProxyBase() {
  const explicit = readEnv('EXPO_PUBLIC_STREAM_PROXY_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  return `${resolveApiBaseUrl()}/stream-proxy`;
}

/**
 * @param {unknown} input
 * @returns {boolean}
 */
export function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
}

/**
 * Signed manifest tokens — must NOT be CDN-rewritten (Bunny /stream-direct returns HTML).
 *
 * @param {unknown} input
 * @returns {boolean}
 */
export function isStreamDirectUrl(input) {
  return /\/stream-direct(?:\?|$)/i.test(String(input ?? ''));
}

/**
 * Rewrite legacy Render stream/API media URLs to Contabo (or configured proxy base).
 * Relative `/uploads/...` paths resolve against the CDN base when present.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function rewriteLegacyRenderMediaUrl(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';

  if (s.startsWith('/')) {
    if (s.startsWith('/stream-proxy') || s.startsWith('/stream-direct')) {
      return `${resolveApiBaseUrl()}${s}`;
    }
    return `${resolveMediaCdnBase()}${s}`;
  }

  if (!/^https?:\/\//i.test(s)) {
    return `${resolveMediaCdnBase()}/${s.replace(/^\/+/, '')}`;
  }

  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    const isLegacy = LEGACY_MEDIA_HOSTS.some((h) => host === h.toLowerCase());
    const isAdminUpload = isAdminUploadPath(host, u.pathname);
    if (!isLegacy && !isAdminUpload) return s;
    if (isStreamDirectUrl(s) || isStreamProxyUrl(s)) {
      const target = new URL(isStreamDirectUrl(s) ? resolveApiBaseUrl() : resolveStreamProxyBase());
      applyUrlOrigin(u, target);
      return u.toString();
    }
    const cdn = new URL(resolveMediaCdnBase());
    applyUrlOrigin(u, cdn);
    return u.toString();
  } catch {
    return s;
  }
}

/**
 * Resolve a catalog/media URL for in-app display or playback.
 * @param {unknown} input
 * @returns {string}
 */
export function resolveMediaAssetUrl(input) {
  return rewriteLegacyRenderMediaUrl(input);
}

const DEFAULT_DISPLAY_MAX_WIDTH = 1080;
const DEFAULT_DISPLAY_QUALITY = 82;

/**
 * Request a smaller BunnyCDN-optimized image for mobile lists/banners.
 * No-op for non-CDN URLs or when optimizer params are already present.
 *
 * @param {unknown} input
 * @param {{ maxWidth?: number; quality?: number }} [opts]
 * @returns {string}
 */
export function optimizeDisplayImageUrl(input, opts = {}) {
  const base = rewriteLegacyRenderMediaUrl(input);
  if (!base) return '';
  const maxWidth = opts.maxWidth ?? DEFAULT_DISPLAY_MAX_WIDTH;
  const quality = opts.quality ?? DEFAULT_DISPLAY_QUALITY;
  try {
    const u = new URL(base);
    if (!u.host.toLowerCase().includes('b-cdn.net')) return base;
    if (u.searchParams.has('width') || u.searchParams.has('optimizer')) return base;
    const path = u.pathname.toLowerCase();
    const looksLikeImage =
      /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(path) || path.includes('/uploads/');
    if (!looksLikeImage) return base;
    u.searchParams.set('width', String(maxWidth));
    u.searchParams.set('quality', String(quality));
    return u.toString();
  } catch {
    return base;
  }
}

/**
 * Deep-clone JSON and rewrite known media URL string fields (API serializer helper).
 * @param {unknown} value
 * @returns {unknown}
 */
export function rewriteMediaUrlsInJson(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) return value;
    if (value.includes('/uploads/') || isStreamProxyUrl(value) || value.startsWith('/uploads/')) {
      return rewriteLegacyRenderMediaUrl(value);
    }
    if (isStreamDirectUrl(value)) return rewriteLegacyRenderMediaUrl(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteMediaUrlsInJson(item));
  }
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteMediaUrlsInJson(v);
    }
    return out;
  }
  return value;
}
