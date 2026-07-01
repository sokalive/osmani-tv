/**
 * Detect and repair stale AsyncStorage subscription hints without clearing app data.
 * Backend verify / subscription-status remain authoritative.
 */

/**
 * @param {string|number|null|undefined} expiresAt
 * @returns {number|null}
 */
function parseExpiresMs(expiresAt) {
  if (expiresAt == null) return null;
  const t = Date.parse(String(expiresAt));
  return Number.isFinite(t) ? t : null;
}

function pickRemainingSecondsFromCache(cached) {
  if (!cached || typeof cached !== 'object') return null;
  const snap = cached.planSnapshot;
  const n = Number(
    snap?.remainingSeconds ??
      snap?.remaining_seconds ??
      cached.remainingSeconds ??
      cached.remaining_seconds,
  );
  return Number.isFinite(n) ? n : null;
}

/**
 * True when cache claims active but timing snapshot looks expired (common after admin extension).
 *
 * @param {Record<string, unknown>|null|undefined} cached
 * @param {number} [nowMs]
 */
export function isStaleActiveSubscriptionCache(cached, nowMs = Date.now()) {
  if (!cached?.active) return false;
  const rem = pickRemainingSecondsFromCache(cached);
  if (rem != null && rem > 0) return false;
  const expMs = parseExpiresMs(cached.expiresAt ?? cached.planSnapshot?.expiresAt);
  if (expMs == null) return false;
  return expMs <= nowMs;
}

/**
 * @param {Record<string, unknown>|null|undefined} cached
 * @param {number} [nowMs]
 */
export function shouldHydrateSubscriptionCache(cached, nowMs = Date.now()) {
  if (!cached?.active) return false;
  if (isStaleActiveSubscriptionCache(cached, nowMs)) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>|null|undefined} cached
 */
export function needsSubscriptionCacheRepair(cached) {
  if (!cached) return true;
  if (!cached.active) return true;
  return isStaleActiveSubscriptionCache(cached);
}
