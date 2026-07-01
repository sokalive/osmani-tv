/**
 * Production subscription recovery — purge stale hints, then trust backend identity chain.
 */

import { clearSubscriptionCache } from '../api/subscription';
import {
  isSameDeviceSubscriptionCache,
  readHydratableSubscriptionCache,
} from './subscriptionCacheHydrate';
import { needsSubscriptionCacheRepair } from './subscriptionCacheRepair';

/** Boot must finish identity migration (Render↔VPS, reinstall) before renewal UI. */
export const SUBSCRIPTION_RECOVERY_BOOT_TIMEOUT_MS = 22_000;

/**
 * Remove unreliable AsyncStorage subscription hints before backend recovery.
 * Clears wrong-device, stale-active, and inactive hints that block ACTIVE restore.
 *
 * @returns {Promise<boolean>} true if cache was purged
 */
export async function purgeUnreliableSubscriptionCache() {
  try {
    const { cached, identity } = await readHydratableSubscriptionCache();
    if (!cached) return false;
    const sameDevice = isSameDeviceSubscriptionCache(cached, identity);
    const mustPurge = !sameDevice || needsSubscriptionCacheRepair(cached);
    if (!mustPurge) return false;
    await clearSubscriptionCache('boot-unreliable-purge');
    console.log('[SUBSCRIPTION_RECOVERY]', 'purged_unreliable_cache', {
      sameDevice,
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
