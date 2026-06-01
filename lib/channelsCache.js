import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'osmani:channels:v1';
export const CHANNELS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<{ channels: unknown[]; savedAt: number; isStale: boolean } | null>}
 */
export async function readChannelsCache() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const savedAt = Number(parsed.savedAt);
    const channels = parsed.channels;
    if (!Number.isFinite(savedAt) || !Array.isArray(channels)) return null;
    const isStale = Date.now() - savedAt > CHANNELS_CACHE_TTL_MS;
    return { channels, savedAt, isStale };
  } catch {
    return null;
  }
}

/**
 * @param {unknown[]} channels
 */
export async function writeChannelsCache(channels) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), channels }),
    );
  } catch {
    // ignore
  }
}
