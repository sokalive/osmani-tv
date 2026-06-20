import { isNetworkTransportError } from './catalogApiFetch';

/**
 * Stale Render block or upstream outage — not the user's mobile data.
 *
 * @param {unknown} errorLike
 * @returns {boolean}
 */
export function isApiMisconfigurationError(errorLike) {
  const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
  return msg.includes('blocked_render_fetch_on_vps_build');
}

/**
 * VPS/admin temporarily unavailable — do not show "internet required" when catalog exists.
 *
 * @param {unknown} errorLike
 * @returns {boolean}
 */
export function isTransientServerError(errorLike) {
  const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
  return (
    /^http\s*(502|503|504)\b/.test(msg) ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout')
  );
}

/**
 * True only when a transport error should block the catalog UX.
 * Background refresh failures must not block taps when channels are already loaded.
 *
 * @param {unknown} errorLike
 * @param {number} catalogChannelCount
 */
export function shouldMarkCatalogOffline(errorLike, catalogChannelCount) {
  if (isApiMisconfigurationError(errorLike)) return false;
  if (isTransientServerError(errorLike)) return false;
  if (!isNetworkTransportError(errorLike)) return false;
  return !(Number(catalogChannelCount) > 0);
}

/**
 * @param {boolean} isOffline
 * @param {number} catalogChannelCount
 */
export function isCatalogInteractionBlocked(isOffline, catalogChannelCount) {
  return isOffline && !(Number(catalogChannelCount) > 0);
}
