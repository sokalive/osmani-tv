/**
 * In-memory cache for catalog API payloads (channels / banners).
 * Reduces duplicate Render hits when foreground sync and SSE debounces overlap.
 * Manual refresh must call {@link invalidateCatalogCache} first.
 */

/** Must stay below {@link OsmaniAppContext} LIVE_SYNC_BASE_MS so foreground ticks fetch fresh accessType. */
const CHANNELS_TTL_MS = 5_000;
const BANNERS_TTL_MS = 5_000;

/** @type {{ data: unknown; fetchedAt: number; inFlight: Promise<unknown> | null; epoch: number }} */
const channelsSlot = { data: null, fetchedAt: 0, inFlight: null, epoch: 0 };
/** @type {{ data: unknown; fetchedAt: number; inFlight: Promise<unknown> | null; epoch: number }} */
const bannersSlot = { data: null, fetchedAt: 0, inFlight: null, epoch: 0 };

function dropSlot(slot) {
  slot.epoch += 1;
  slot.data = null;
  slot.fetchedAt = 0;
  slot.inFlight = null;
}

export function invalidateCatalogCache() {
  dropSlot(channelsSlot);
  dropSlot(bannersSlot);
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
  if (!force && slot.inFlight) {
    return slot.inFlight;
  }
  if (force) {
    slot.epoch += 1;
    slot.inFlight = null;
  }
  const epoch = slot.epoch;
  const promise = fetcher()
    .then((data) => {
      if (slot.epoch !== epoch) return data;
      slot.data = data;
      slot.fetchedAt = Date.now();
      if (slot.inFlight === promise) slot.inFlight = null;
      return data;
    })
    .catch((err) => {
      if (slot.inFlight === promise) slot.inFlight = null;
      if (slot.epoch !== epoch) throw err;
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
