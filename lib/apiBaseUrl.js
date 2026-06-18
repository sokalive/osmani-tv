/**
 * Single source of truth for Admin API host (JSON, SSE, payments, stream-direct).
 * OTA + native builds read EXPO_PUBLIC_API_URL when set; otherwise DEFAULT_API_URL.
 */

export const DEFAULT_API_URL = 'http://144.91.117.90:10001';

/** HTTPS Render mirror — shared Vultr DB; transport fallback when Contabo HTTP blocked. */
export const LEGACY_HTTPS_API_FALLBACK = 'https://osmani-admin-api.onrender.com';

/** Legacy media/API hosts rewritten in JSON only — not forced at runtime fetch layer. */
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
 * @returns {string} Origin without trailing slash — honors embedded EXPO_PUBLIC_API_URL (Render or Contabo).
 */
export function resolveApiBaseUrl() {
  const raw = readExpoPublicApiUrl() ?? DEFAULT_API_URL;
  return String(raw).replace(/\/+$/, '');
}

/** @returns {string} */
export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}
