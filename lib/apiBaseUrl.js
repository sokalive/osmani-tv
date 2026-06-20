import Constants from 'expo-constants';

/**
 * Admin API host resolution (JSON, SSE, payments, stream-direct).
 *
 * Build-time `EXPO_PUBLIC_API_URL` selects the target:
 *   - Play / VPS production APKs + OTA: https://api.osmanitv.com
 *   - Legacy Render APKs / OTA: https://osmani-admin-api.onrender.com
 *
 * When unset in an OTA bundle, {@link readManifestApiUrl} (native extra) is used
 * before {@link DEFAULT_API_URL} so Play v24 keeps VPS after JS updates.
 */

/** Existing Render production — must remain default for shipped Render APKs + OTA. */
export const RENDER_PRODUCTION_API_URL = 'https://osmani-admin-api.onrender.com';

/** New VPS HTTPS domain (vps-preview EAS profile only until Play migration). */
export const VPS_PRODUCTION_API_URL = 'https://api.osmanitv.com';

/** Safe runtime default when no EXPO_PUBLIC_API_URL is embedded (Render HTTPS). */
export const DEFAULT_API_URL = RENDER_PRODUCTION_API_URL;

/** HTTPS Render mirror — transport fallback when primary VPS host is unreachable. */
export const LEGACY_HTTPS_API_FALLBACK = RENDER_PRODUCTION_API_URL;

/** Hosts rewritten in catalog JSON only — never used as forced runtime fetch targets. */
export const LEGACY_API_HOSTS = Object.freeze([
  'https://osmani-admin-api.onrender.com',
  'https://osmani-tv.onrender.com',
  'http://osmani-admin-api.onrender.com',
  'http://osmani-tv.onrender.com',
  'http://144.91.117.90:10001',
  'https://144.91.117.90:10001',
  'http://144.91.117.90',
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

/** Native manifest extra — survives OTA when EXPO_PUBLIC_* was not re-inlined. */
function readManifestApiUrl() {
  try {
    const v = Constants.expoConfig?.extra?.apiBaseUrl;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Play Store VPS migration (v23+ / 1.8.x) — native versionCode survives OTA even when
 * a JS bundle omits EXPO_PUBLIC_API_URL and falls back to legacy Render DEFAULT.
 */
function readPlayVpsMigrationDefault() {
  try {
    const vc = Number(Constants.expoConfig?.android?.versionCode);
    if (Number.isFinite(vc) && vc >= 23) return VPS_PRODUCTION_API_URL;
    const ver = String(Constants.expoConfig?.version ?? '').trim();
    if (/^1\.8(\.|$)/.test(ver)) return VPS_PRODUCTION_API_URL;
  } catch {
    // ignore
  }
  return null;
}

/**
 * @returns {string} Origin without trailing slash.
 */
export function resolveApiBaseUrl() {
  const raw =
    readExpoPublicApiUrl() ??
    readManifestApiUrl() ??
    readPlayVpsMigrationDefault() ??
    DEFAULT_API_URL;
  return String(raw).replace(/\/+$/, '');
}

/** @returns {string} */
export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}

/** @returns {boolean} True when build targets the new VPS HTTPS domain. */
export function isVpsApiTarget() {
  try {
    return new URL(resolveApiBaseUrl()).host.toLowerCase() === 'api.osmanitv.com';
  } catch {
    return false;
  }
}

/** @returns {boolean} True when build targets Render production HTTPS. */
export function isRenderApiTarget() {
  try {
    const host = new URL(resolveApiBaseUrl()).host.toLowerCase();
    return host === 'osmani-admin-api.onrender.com' || host === 'osmani-tv.onrender.com';
  } catch {
    return false;
  }
}
