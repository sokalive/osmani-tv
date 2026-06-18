import { isNetworkTransportError } from './catalogApiFetch';

/**
 * True only when a transport error should block the catalog UX.
 * Background refresh failures must not block taps when channels are already loaded.
 *
 * @param {unknown} errorLike
 * @param {number} catalogChannelCount
 */
export function shouldMarkCatalogOffline(errorLike, catalogChannelCount) {
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
