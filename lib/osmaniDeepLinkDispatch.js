/** @type {((url: string) => void) | null} */
let handler = null;
/** @type {string[]} */
const pendingUrls = [];

/**
 * Queue or run a deep link / notification open URL.
 * Safe before React navigation and catalog are ready.
 *
 * @param {string} url
 */
export function dispatchOsmaniDeepLink(url) {
  const s = String(url ?? '').trim();
  if (!s) return;
  if (typeof handler === 'function') {
    handler(s);
    return;
  }
  pendingUrls.push(s);
}

/**
 * Register the active handler (OsmaniDeepLinkGate) and flush queued URLs.
 *
 * @param {((url: string) => void) | null} next
 */
export function setOsmaniDeepLinkHandler(next) {
  handler = typeof next === 'function' ? next : null;
  if (!handler || pendingUrls.length === 0) return;
  while (pendingUrls.length > 0) {
    const u = pendingUrls.shift();
    if (u) handler(u);
  }
}

/** @returns {number} */
export function getPendingOsmaniDeepLinkCount() {
  return pendingUrls.length;
}
