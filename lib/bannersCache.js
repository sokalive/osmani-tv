import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'osmani:banners:v2';
const LEGACY_STORAGE_KEY = 'osmani:banners:v1';
/** Max age to treat disk cache as "fresh" for metadata only; reads always return last payload for stale-while-revalidate UI. */
export const BANNERS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<{ banners: unknown[]; savedAt: number; isStale: boolean } | null>}
 */
export async function readBannersCache() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const savedAt = Number(parsed.savedAt);
    const banners = parsed.banners;
    if (!Number.isFinite(savedAt) || !Array.isArray(banners)) return null;
    const isStale = Date.now() - savedAt > BANNERS_CACHE_TTL_MS;
    return { banners, savedAt, isStale };
  } catch {
    return null;
  }
}

/**
 * @param {unknown[]} banners
 */
export async function writeBannersCache(banners) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), banners }),
    );
  } catch {
    // ignore
  }
}

/** Drop all cached banner payloads (pull-to-refresh / debug). */
export async function clearBannersCache() {
  try {
    await AsyncStorage.multiRemove([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  } catch {
    // ignore
  }
}

/** Remove pre-timer v1 cache so cold start cannot load shape-incompatible banners. */
export async function dropLegacyBannersCache() {
  try {
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}
