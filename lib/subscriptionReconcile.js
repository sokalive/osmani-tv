/**
 * When true, subscription verify must bypass fast status probe and cache preserve
 * so admin revoke/grant events reconcile immediately against VPS verify.
 */

/** @param {unknown} reason */
export function isAuthoritativeReconcileReason(reason) {
  const r = String(reason ?? '');
  if (!r) return false;
  return (
    r.includes('subscription_revoked') ||
    r.includes('entitlement_changed') ||
    r.includes('subscription_granted') ||
    r.includes('subscription_activated') ||
    r.includes('manual_subscription_granted') ||
    r.includes('package_granted') ||
    r.includes('admin_subscription_granted') ||
    r.includes('subscription-stream:') ||
    r.includes('subscription_changed') ||
    r.includes('subscription_updated') ||
    r.includes('subscription_status_changed') ||
    r === 'sse:sync_stream_connected'
  );
}

/** Channel/catalog SSE names that should refresh access fields immediately (no debounce). */
export const CHANNEL_ACCESS_IMMEDIATE_SSE_EVENTS = new Set([
  'channel_created',
  'channel_updated',
  'channel_deleted',
  'channel_access_changed',
  'access_type_changed',
  'channel_access_updated',
  'channels_changed',
  'channels_updated',
  'catalog_changed',
  'catalog_refresh',
  'sync',
]);
