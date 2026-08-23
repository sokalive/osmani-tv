import { getCachedBanners, getCachedChannels, invalidateCatalogCache } from './lib/catalogCache';
import { DEFAULT_API_URL, getApiBaseUrl, resolveApiBaseUrl } from './lib/apiBaseUrl';
import { fetchAdminApiJson } from './lib/catalogApiFetch';
import { getDeviceIdentity } from './lib/deviceIdentity';
import { rewriteMediaUrlsInJson } from './lib/mediaDelivery';
import { enrichBannersForViewer } from './lib/bannerViewerSerializer';
import {
  deviceIdentityHeaders,
  sanitizeCatalogChannelForClient,
} from './lib/playbackEntitlementClient';

export { invalidateCatalogCache, getApiBaseUrl, resolveApiBaseUrl };

/**
 * Contabo Admin API (JSON / SSE / payments / stream-direct).
 * Always resolve at request time — never snapshot at module load (OTA may change embed).
 */
export function getBaseUrl() {
  return resolveApiBaseUrl();
}

/** @deprecated Use {@link getBaseUrl} or {@link resolveApiBaseUrl} at request time. */
export function getLegacyBaseUrlSnapshot() {
  return resolveApiBaseUrl();
}

async function fetchChannelsFromNetwork(opts = {}) {
  const identity = await getDeviceIdentity();
  const deviceId = String(identity?.deviceId ?? '').trim();
  const path = deviceId
    ? `/api/channels?device_id=${encodeURIComponent(deviceId)}`
    : '/api/channels';
  const body = await fetchAdminApiJson(path, {
    tag: 'catalog-channels',
    headers: deviceIdentityHeaders(deviceId),
    ...(opts.force || opts.cacheBust ? { cacheBust: true } : {}),
  });
  if (!Array.isArray(body)) {
    throw new Error('Could not load channels (invalid response)');
  }
  const sanitized = body.map((row) =>
    row && typeof row === 'object' ? sanitizeCatalogChannelForClient(row) : row,
  );
  return rewriteMediaUrlsInJson(sanitized);
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
  return getCachedChannels(() => fetchChannelsFromNetwork(opts), opts);
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
  try {
    const body = await fetchAdminApiJson('/api/server-health', { tag: 'server-health' });
    if (!body || typeof body !== 'object') {
      throw new Error('Could not load server health (invalid response)');
    }
    return body;
  } catch (e) {
    const status = String(e?.message ?? '');
    if (!/HTTP (403|404)/.test(status)) throw e;
    const ping = await fetchAdminApiJson('/api/health', { tag: 'api-health' }).catch(() => null);
    if (ping && typeof ping === 'object') {
      return { channels: [], degraded: true, health: ping };
    }
    throw e;
  }
}

export { DEFAULT_API_URL };
