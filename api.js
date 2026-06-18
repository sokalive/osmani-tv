import { getCachedBanners, getCachedChannels, invalidateCatalogCache } from './lib/catalogCache';
import { DEFAULT_API_URL, getApiBaseUrl, resolveApiBaseUrl } from './lib/apiBaseUrl';
import { fetchAdminApiJson } from './lib/catalogApiFetch';
import { rewriteMediaUrlsInJson } from './lib/mediaDelivery';
import { enrichBannersForViewer } from './lib/bannerViewerSerializer';

export { invalidateCatalogCache, getApiBaseUrl, resolveApiBaseUrl };

/**
 * Contabo Admin API (JSON / SSE / payments / stream-direct).
 * Resolved at request time via {@link getApiBaseUrl} for catalog; legacy imports use this snapshot.
 */
export const BASE_URL = getApiBaseUrl();

async function fetchChannelsFromNetwork() {
  const body = await fetchAdminApiJson('/api/channels', { tag: 'catalog-channels' });
  if (!Array.isArray(body)) {
    throw new Error('Could not load channels (invalid response)');
  }
  return rewriteMediaUrlsInJson(body);
}

async function fetchBannersFromNetwork() {
  const body = await fetchAdminApiJson('/api/banners', { tag: 'catalog-banners' });
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
  const body = await fetchAdminApiJson('/api/whatsapp-settings', { tag: 'whatsapp-settings' });
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load WhatsApp settings (invalid response)');
  }
  return body;
}

export async function getPopupSettings() {
  const body = await fetchAdminApiJson('/api/popup-settings', { tag: 'popup-settings' });
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load popup settings (invalid response)');
  }
  return body;
}

export async function getServerHealth() {
  const body = await fetchAdminApiJson('/api/server-health', { tag: 'server-health' });
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load server health (invalid response)');
  }
  return body;
}

export { DEFAULT_API_URL };
