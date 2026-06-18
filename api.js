import { getCachedBanners, getCachedChannels, invalidateCatalogCache } from './lib/catalogCache';
import { DEFAULT_API_URL, resolveApiBaseUrl } from './lib/apiBaseUrl';
import { rewriteMediaUrlsInJson } from './lib/mediaDelivery';
import { enrichBannersForViewer } from './lib/bannerViewerSerializer';

export { invalidateCatalogCache };

/**
 * Contabo Admin API (JSON / SSE / payments / stream-direct).
 * Public uploads may use CDN via {@link ./lib/mediaDelivery}; stream-proxy defaults to Contabo.
 * All HTTP modules (`api.js`, `api/payment.js`, `api/settings.js`, etc.) must use this `BASE_URL`.
 */
export const BASE_URL = resolveApiBaseUrl();

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

/** @deprecated Use {@link DEFAULT_API_URL} from lib/apiBaseUrl.js */
export { DEFAULT_API_URL };
