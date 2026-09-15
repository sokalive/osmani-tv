/**
 * Production subscription recovery — purge stale hints, then trust backend identity chain.
 */

import { clearSubscriptionCache, readSubscriptionCache } from '../api/subscription';
import { getDeviceIdentity } from './deviceIdentity';
import {
  isSameDeviceSubscriptionCache,
  readHydratableSubscriptionCache,
} from './subscriptionCacheHydrate';
import { isStaleActiveSubscriptionCache } from './subscriptionCacheRepair';

/** Boot must finish identity migration (Render↔VPS, reinstall) before renewal UI. */
export const SUBSCRIPTION_RECOVERY_BOOT_TIMEOUT_MS = 45_000;

/**
 * Remove wrong-device, inactive, or temporally expired AsyncStorage hints before backend recovery.
 * Uses raw cache (not only the hydratable view) so untrustworthy rows cannot linger on disk.
 *
 * @returns {Promise<boolean>} true if cache was purged
 */
export async function purgeUnreliableSubscriptionCache() {
  try {
    const cached = await readSubscriptionCache();
    if (!cached) return false;

    if (isStaleActiveSubscriptionCache(cached)) {
      await clearSubscriptionCache('boot-expired-purge');
      console.log('[SUBSCRIPTION_RECOVERY]', 'purged_expired_cache', {
        expiresAt: cached.expiresAt ?? null,
      });
      return true;
    }

    if (cached.active !== true) {
      await clearSubscriptionCache('boot-inactive-purge');
      console.log('[SUBSCRIPTION_RECOVERY]', 'purged_inactive_cache', {
        hadActive: false,
        expiresAt: cached.expiresAt ?? null,
      });
      return true;
    }

    let identity;
    try {
      identity = await getDeviceIdentity();
    } catch {
      identity = { deviceId: '' };
    }

    if (isSameDeviceSubscriptionCache(cached, identity)) {
      return false;
    }

    // Same-device via stored identity hints (reinstall / migration) — keep.
    const { cached: hydratable } = await readHydratableSubscriptionCache();
    if (hydratable) return false;

    await clearSubscriptionCache('boot-unreliable-purge');
    console.log('[SUBSCRIPTION_RECOVERY]', 'purged_unreliable_cache', {
      sameDevice: false,
      hadActive: Boolean(cached.active),
      expiresAt: cached.expiresAt ?? null,
    });
    return true;
  } catch (e) {
    console.log('[SUBSCRIPTION_RECOVERY]', 'purge_error', e?.message ?? e);
    return false;
  }
}

/**
 * @param {unknown} result
 */
export function backendConfirmsActiveSubscription(result) {
  return Boolean(result && result.active === true);
}

/**
 * @param {unknown} result
 */
export function backendConfirmsInactiveSubscription(result) {
  if (!result || result.active === true) return false;
  if (result.transportPreserved === true) return false;
  const src = String(result.resolveSource ?? '');
  return src === 'inactive';
}
