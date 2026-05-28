import { getCachedBanners, getCachedChannels, invalidateCatalogCache } from './lib/catalogCache';
import { rewriteMediaUrlsInJson } from './lib/mediaDelivery';
import { enrichBannersForViewer } from './lib/bannerViewerSerializer';

export { invalidateCatalogCache };

/**
 * Production Render API host for the mobile app (JSON / SSE / payments only).
 * Public media (uploads, stream-proxy) uses {@link ./lib/mediaDelivery} → BunnyCDN.
 * All HTTP modules (`api.js`, `api/payment.js`, `api/settings.js`, etc.) must use this `BASE_URL`.
 */
const DEFAULT_API_URL = "https://osmani-admin-api.onrender.com";
/** Older deploy; `/api/channels` is empty there — builds must hit Admin API for channel JSON. */
const LEGACY_TV_HOST = "https://osmani-tv.onrender.com";

function getExpoPublicApiUrl() {
  try {
    const env = typeof process !== "undefined" ? process.env : undefined;
    const v = env?.EXPO_PUBLIC_API_URL;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function resolveBaseUrl() {
  const raw = getExpoPublicApiUrl() ?? DEFAULT_API_URL;
  const stripped = String(raw).replace(/\/+$/, "");
  if (stripped.toLowerCase() === LEGACY_TV_HOST.toLowerCase()) {
    return DEFAULT_API_URL;
  }
  return stripped;
}

// Centralized API base URL:
// - Uses EXPO_PUBLIC_API_URL when provided (Expo web build-time injection)
// - Falls back to the current Render API host for safety
// - Rewrites legacy `osmani-tv.onrender.com` so channel/catalog calls hit Admin API
export const BASE_URL = resolveBaseUrl();

async function fetchChannelsFromNetwork() {
  const res = await fetch(`${BASE_URL}/api/channels`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const extra =
      body && typeof body === 'object' && body.error != null
        ? ` — ${String(body.error)}`
        : '';
    throw new Error(`Could not load channels (${res.status})${extra}`);
  }
  if (!Array.isArray(body)) {
    throw new Error('Could not load channels (invalid response)');
  }
  return rewriteMediaUrlsInJson(body);
}

async function fetchBannersFromNetwork() {
  const res = await fetch(`${BASE_URL}/api/banners`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const extra =
      body && typeof body === 'object' && body.error != null
        ? ` — ${String(body.error)}`
        : '';
    throw new Error(`Could not load banners (${res.status})${extra}`);
  }
  if (!Array.isArray(body)) {
    throw new Error('Could not load banners (invalid response)');
  }
  return enrichBannersForViewer(rewriteMediaUrlsInJson(body));
}

/**
 * @param {{ force?: boolean }} [opts] — pass force: true after pull-to-refresh
 */
export async function getChannels(opts = {}) {
  return getCachedChannels(() => fetchChannelsFromNetwork(), opts);
}

/**
 * @param {{ force?: boolean }} [opts] — pass force: true after pull-to-refresh
 */
export async function getBanners(opts = {}) {
  return getCachedBanners(() => fetchBannersFromNetwork(), opts);
}

export async function getWhatsappSettings() {
  const res = await fetch(`${BASE_URL}/api/whatsapp-settings`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error(`Could not load WhatsApp settings (${res.status})`);
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load WhatsApp settings (invalid response)');
  }
  return body;
}

export async function getPopupSettings() {
  const res = await fetch(`${BASE_URL}/api/popup-settings`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error(`Could not load popup settings (${res.status})`);
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load popup settings (invalid response)');
  }
  return body;
}

export async function getServerHealth() {
  const res = await fetch(`${BASE_URL}/api/server-health`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error(`Could not load server health (${res.status})`);
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load server health (invalid response)');
  }
  return body;
}
