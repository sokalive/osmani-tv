/**
 * In-memory cache for catalog API payloads (channels / banners).
 * Reduces duplicate Render hits when foreground sync and SSE debounces overlap.
 * Manual refresh must call {@link invalidateCatalogCache} first.
 */

const CHANNELS_TTL_MS = 45_000;
const BANNERS_TTL_MS = 45_000;

/** @type {{ data: unknown; fetchedAt: number; inFlight: Promise<unknown> | null }} */
const channelsSlot = { data: null, fetchedAt: 0, inFlight: null };
/** @type {{ data: unknown; fetchedAt: number; inFlight: Promise<unknown> | null }} */
const bannersSlot = { data: null, fetchedAt: 0, inFlight: null };

export function invalidateCatalogCache() {
  channelsSlot.data = null;
  channelsSlot.fetchedAt = 0;
  channelsSlot.inFlight = null;
  bannersSlot.data = null;
  bannersSlot.fetchedAt = 0;
  bannersSlot.inFlight = null;
}

/**
 * @template T
 * @param {{ data: T | null; fetchedAt: number; inFlight: Promise<T> | null }} slot
 * @param {number} ttlMs
 * @param {() => Promise<T>} fetcher
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<T>}
 */
async function cachedGet(slot, ttlMs, fetcher, opts = {}) {
  const now = Date.now();
  const force = opts.force === true;
  if (!force && slot.data != null && now - slot.fetchedAt < ttlMs) {
    return slot.data;
  }
  if (slot.inFlight) {
    return slot.inFlight;
  }
  const promise = fetcher()
    .then((data) => {
      slot.data = data;
      slot.fetchedAt = Date.now();
      slot.inFlight = null;
      return data;
    })
    .catch((err) => {
      slot.inFlight = null;
      if (slot.data != null) return slot.data;
      throw err;
    });
  slot.inFlight = promise;
  return promise;
}

/**
 * @param {() => Promise<unknown>} fetcher
 * @param {{ force?: boolean }} [opts]
 */
export function getCachedChannels(fetcher, opts) {
  return cachedGet(channelsSlot, CHANNELS_TTL_MS, fetcher, opts);
}

/**
 * @param {() => Promise<unknown>} fetcher
 * @param {{ force?: boolean }} [opts]
 */
export function getCachedBanners(fetcher, opts) {
  return cachedGet(bannersSlot, BANNERS_TTL_MS, fetcher, opts);
}
