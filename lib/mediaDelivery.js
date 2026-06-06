/**
 * Public media / stream-proxy delivery (BunnyCDN) — separate from API `BASE_URL`.
 *
 * API + SSE stay on Render (`osmani-admin-api.onrender.com`).
 * Static uploads, images, and `/stream-proxy` playback should use the CDN host.
 *
 * Installed APKs without this module still work when the Admin API returns
 * absolute `https://osmanitv.b-cdn.net/...` URLs in channel/banner JSON.
 */

export const DEFAULT_MEDIA_CDN_BASE = 'https://osmanitv.b-cdn.net';

/** stream-direct tokens must be fetched from the issuing API host, never Bunny CDN. */
const STREAM_DIRECT_API_HOST = 'osmani-admin-api.onrender.com';

/** Hosts that historically served `/uploads` and `/stream-proxy` from Render. */
export const LEGACY_MEDIA_HOSTS = Object.freeze([
  'osmani-admin-api.onrender.com',
  'osmani-tv.onrender.com',
]);

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
  return `${resolveMediaCdnBase()}/stream-proxy`;
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
 * Repair CDN-rewritten stream-direct URLs (returns HTML / wrong origin on first launch).
 *
 * @param {unknown} input
 * @returns {string}
 */
export function repairStreamDirectApiHost(input) {
  const s = String(input ?? '').trim();
  if (!s || !isStreamDirectUrl(s)) return s;
  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    if (host === STREAM_DIRECT_API_HOST.toLowerCase()) return s;
    if (host.includes('b-cdn.net') || LEGACY_MEDIA_HOSTS.some((h) => host === h.toLowerCase())) {
      u.protocol = 'https:';
      u.host = STREAM_DIRECT_API_HOST;
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return s;
}

/**
 * Rewrite legacy Render media/proxy URLs to the CDN host.
 * Relative `/uploads/...` paths resolve against the CDN base.
 * `/stream-direct` stays on the issuing API host.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function rewriteLegacyRenderMediaUrl(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';

  if (isStreamDirectUrl(s)) {
    return repairStreamDirectApiHost(s);
  }

  if (s.startsWith('/')) {
    return `${resolveMediaCdnBase()}${s}`;
  }

  if (!/^https?:\/\//i.test(s)) {
    return `${resolveMediaCdnBase()}/${s.replace(/^\/+/, '')}`;
  }

  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    const isLegacy = LEGACY_MEDIA_HOSTS.some((h) => host === h.toLowerCase());
    if (!isLegacy) return s;
    const cdn = new URL(resolveMediaCdnBase());
    u.protocol = cdn.protocol;
    u.host = cdn.host;
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
    if (isStreamDirectUrl(value)) return value;
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
