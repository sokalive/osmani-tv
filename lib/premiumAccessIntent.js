/**
 * Ephemeral premium-channel tap intent — never persisted.
 * Popup may open only while a fresh explicit premium content tap exists.
 */

/** @type {{ channelKey: string; grantedAt: number } | null} */
let activeIntent = null;

/** Max age for a tap intent before it is treated as stale (ms). */
export const PREMIUM_ACCESS_INTENT_TTL_MS = 60_000;

/**
 * @param {{ channelKey?: string; channel?: object }} [meta]
 */
export function grantPremiumAccessIntent(meta = {}) {
  const channelKey = String(
    meta.channelKey ??
      meta.channel?.id ??
      meta.channel?.channel_id ??
      meta.channel?.name ??
      '',
  ).trim();
  activeIntent = { channelKey, grantedAt: Date.now() };
}

export function clearPremiumAccessIntent() {
  activeIntent = null;
}

/**
 * @returns {boolean}
 */
export function hasFreshPremiumAccessIntent() {
  if (!activeIntent) return false;
  if (Date.now() - activeIntent.grantedAt > PREMIUM_ACCESS_INTENT_TTL_MS) {
    activeIntent = null;
    return false;
  }
  return true;
}

/**
 * @returns {{ channelKey: string; grantedAt: number } | null}
 */
export function consumePremiumAccessIntent() {
  if (!hasFreshPremiumAccessIntent()) return null;
  const intent = activeIntent;
  activeIntent = null;
  return intent;
}

/**
 * @returns {{ channelKey: string; grantedAt: number } | null}
 */
export function peekPremiumAccessIntent() {
  return hasFreshPremiumAccessIntent() ? activeIntent : null;
}
