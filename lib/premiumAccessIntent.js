/**
 * Ephemeral premium-channel tap intent — never persisted.
 * One explicit tap creates a durable pending action until terminal resolution.
 */

/** @type {{ channelKey: string; grantedAt: number; generation: number } | null} */
let activeIntent = null;

let generationCounter = 0;

/** Max age for a tap intent before it is treated as stale (ms). */
export const PREMIUM_ACCESS_INTENT_TTL_MS = 60_000;

function channelKeyFromMeta(meta = {}) {
  return String(
    meta.channelKey ??
      meta.channel?.id ??
      meta.channel?.channel_id ??
      meta.channel?.name ??
      '',
  ).trim();
}

/**
 * Begin or refresh a single-flight pending premium action for one explicit tap.
 * @param {{ channelKey?: string; channel?: object }} [meta]
 * @returns {number} generation id
 */
export function grantPremiumAccessIntent(meta = {}) {
  const channelKey = channelKeyFromMeta(meta);
  const now = Date.now();
  if (
    activeIntent &&
    activeIntent.channelKey === channelKey &&
    now - activeIntent.grantedAt <= PREMIUM_ACCESS_INTENT_TTL_MS
  ) {
    activeIntent.grantedAt = now;
    return activeIntent.generation;
  }
  generationCounter += 1;
  activeIntent = { channelKey, grantedAt: now, generation: generationCounter };
  return generationCounter;
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
 * @returns {{ channelKey: string; grantedAt: number; generation: number } | null}
 */
export function consumePremiumAccessIntent() {
  if (!hasFreshPremiumAccessIntent()) return null;
  const intent = activeIntent;
  activeIntent = null;
  return intent;
}

/**
 * @returns {{ channelKey: string; grantedAt: number; generation: number } | null}
 */
export function peekPremiumAccessIntent() {
  return hasFreshPremiumAccessIntent() ? activeIntent : null;
}

/** @type {object | null} */
let pendingChannel = null;

/**
 * Retain channel target for deferred first-tap completion.
 * @param {object|null} channel
 */
export function setPremiumPendingChannel(channel) {
  pendingChannel = channel ?? null;
}

/**
 * @returns {object | null}
 */
export function getPremiumPendingChannel() {
  return pendingChannel;
}

/**
 * @returns {object | null}
 */
export function takePremiumPendingChannel() {
  const ch = pendingChannel;
  pendingChannel = null;
  return ch;
}

/**
 * Refresh pending intent timestamp while entitlement is still resolving.
 * Never clears the original first-tap action.
 */
export function touchPremiumAccessIntent() {
  if (!activeIntent) return false;
  if (Date.now() - activeIntent.grantedAt > PREMIUM_ACCESS_INTENT_TTL_MS) {
    activeIntent = null;
    return false;
  }
  activeIntent.grantedAt = Date.now();
  return true;
}
