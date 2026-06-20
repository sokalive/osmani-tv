import { readSubscriptionCache } from '../api/subscription';

/**
 * Optimistic UI hint from AsyncStorage — never overrides a later server deny.
 *
 * @param {{ deviceId?: string; androidId?: string | null }} identity
 * @returns {Promise<{ active: true; expiresAt: string | null } | null>}
 */
export async function hydrateSubscriptionFromCache(identity = {}) {
  try {
    const cached = await readSubscriptionCache();
    if (!cached?.active) return null;

    const deviceId = String(identity.deviceId ?? '').trim();
    const androidId = String(identity.androidId ?? '').trim();
    const sameDevice =
      !cached.deviceId ||
      cached.deviceId === deviceId ||
      (androidId && cached.deviceId === androidId);
    if (!sameDevice) return null;

    if (cached.expiresAt) {
      const expMs = Date.parse(String(cached.expiresAt));
      if (Number.isFinite(expMs) && expMs <= Date.now()) return null;
    }

    return { active: true, expiresAt: cached.expiresAt ?? null };
  } catch {
    return null;
  }
}
