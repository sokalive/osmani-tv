import Constants from 'expo-constants';
import { forcedPlayVpsApiBaseUrl, isPlayStoreVpsBuild } from './playVpsApiHost';

/**
 * Admin API host resolution (JSON, SSE, payments, stream-direct).
 *
 * Play Store builds (native versionCode >= 16, OTA-capable) ALWAYS use https://api.osmanitv.com
 * regardless of stale OTA JS env or legacy DEFAULT_API_URL.
 */

/** Existing Render production — legacy Render APKs + OTA only. */
export const RENDER_PRODUCTION_API_URL = 'https://osmani-admin-api.onrender.com';

/** Play / VPS production HTTPS API. */
export const VPS_PRODUCTION_API_URL = 'https://api.osmanitv.com';

/** Legacy Render default when no embed (Render APKs only). */
export const DEFAULT_API_URL = RENDER_PRODUCTION_API_URL;

/** Cleartext HTTP APKs may mirror to HTTPS Render — never used for VPS Play builds. */
export const LEGACY_HTTPS_API_FALLBACK = RENDER_PRODUCTION_API_URL;

/** Hosts rewritten in catalog JSON only — never used as runtime fetch targets. */
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

function readManifestApiUrl() {
  try {
    const v = Constants.expoConfig?.extra?.apiBaseUrl;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * @returns {string} Origin without trailing slash.
 */
export function resolveApiBaseUrl() {
  const playVps = forcedPlayVpsApiBaseUrl();
  if (playVps) return playVps;
  const raw = readExpoPublicApiUrl() ?? readManifestApiUrl() ?? DEFAULT_API_URL;
  return String(raw).replace(/\/+$/, '');
}

/** @returns {string} */
export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}

/** @returns {boolean} */
export function isVpsApiTarget() {
  try {
    return new URL(resolveApiBaseUrl()).host.toLowerCase() === 'api.osmanitv.com';
  } catch {
    return isPlayStoreVpsBuild();
  }
}

/** @returns {boolean} */
export function isRenderApiTarget() {
  try {
    const host = new URL(resolveApiBaseUrl()).host.toLowerCase();
    return host === 'osmani-admin-api.onrender.com' || host === 'osmani-tv.onrender.com';
  } catch {
    return false;
  }
}
