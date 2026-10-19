/**
 * In-memory cache for catalog API payloads (channels / banners).
 * Reduces duplicate Render hits when foreground sync and SSE debounces overlap.
 * Manual refresh must call {@link invalidateCatalogCache} first.
 */

/** Must stay below {@link OsmaniAppContext} LIVE_SYNC_BASE_MS so foreground ticks fetch fresh accessType. */
const CHANNELS_TTL_MS = 5_000;
const BANNERS_TTL_MS = 5_000;

/** @type {{ data: unknown; fetchedAt: number; inFlight: Promise<unknown> | null; epoch: number; followUp: boolean }} */
const channelsSlot = { data: null, fetchedAt: 0, inFlight: null, epoch: 0, followUp: false, followFetcher: null };
/** @type {{ data: unknown; fetchedAt: number; inFlight: Promise<unknown> | null; epoch: number; followUp: boolean; followFetcher: (() => Promise<unknown>) | null }} */
const bannersSlot = { data: null, fetchedAt: 0, inFlight: null, epoch: 0, followUp: false, followFetcher: null };

function dropSlot(slot) {
  slot.epoch += 1;
  slot.data = null;
  slot.fetchedAt = 0;
  slot.inFlight = null;
  slot.followUp = false;
  slot.followFetcher = null;
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
  if (slot.inFlight) {
    if (force) {
      slot.followUp = true;
      slot.followFetcher = fetcher;
    }
    return slot.inFlight;
  }
  if (force) {
    slot.epoch += 1;
    slot.data = null;
    slot.fetchedAt = 0;
  }
  const epoch = slot.epoch;
  const flight = fetcher()
    .then((data) => data)
    .catch((err) => {
      throw err;
    });
  const chain = flight
    .then((data) => {
      if (slot.inFlight === chain) slot.inFlight = null;
      if (slot.epoch !== epoch) return data;
      if (slot.followUp) {
        const nextFetcher = slot.followFetcher || fetcher;
        slot.followUp = false;
        slot.followFetcher = null;
        return cachedGet(slot, ttlMs, nextFetcher, { force: true });
      }
      slot.data = data;
      slot.fetchedAt = Date.now();
      return data;
    })
    .catch((err) => {
      if (slot.inFlight === chain) slot.inFlight = null;
      if (slot.epoch !== epoch) throw err;
      if (slot.followUp) {
        const nextFetcher = slot.followFetcher || fetcher;
        slot.followUp = false;
        slot.followFetcher = null;
        return cachedGet(slot, ttlMs, nextFetcher, { force: true });
      }
      if (slot.data != null) return slot.data;
      throw err;
    });
  slot.inFlight = chain;
  return chain;
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
