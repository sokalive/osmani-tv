/**
 * Single source of truth for Admin API host (JSON, SSE, payments, stream-direct).
 * OTA + native builds read EXPO_PUBLIC_API_URL when set; otherwise DEFAULT_API_URL.
 */

export const DEFAULT_API_URL = 'http://144.91.117.90:10001';

/** Legacy hosts that must never be used in production — remap to {@link DEFAULT_API_URL}. */
export const LEGACY_API_HOSTS = Object.freeze([
  'https://osmani-admin-api.onrender.com',
  'https://osmani-tv.onrender.com',
  'http://osmani-admin-api.onrender.com',
  'http://osmani-tv.onrender.com',
]);

function readExpoPublicApiUrl() {
  try {
    const env = typeof process !== 'undefined' ? process.env : undefined;
    const v = env?.EXPO_PUBLIC_API_URL;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * @returns {string} Origin without trailing slash (e.g. http://144.91.117.90:10001)
 */
export function resolveApiBaseUrl() {
  const raw = readExpoPublicApiUrl() ?? DEFAULT_API_URL;
  const stripped = String(raw).replace(/\/+$/, '');
  const lower = stripped.toLowerCase();
  if (LEGACY_API_HOSTS.some((h) => h.toLowerCase() === lower)) {
    return DEFAULT_API_URL;
  }
  return stripped;
}

/** @returns {string} */
export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}
