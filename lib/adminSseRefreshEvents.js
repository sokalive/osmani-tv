/**
 * SSE `event:` names the Admin API may emit when public catalog or commerce
 * metadata changes. Listed here so {@link ../lib/realtimeSync} registers
 * listeners (unknown names never reach JS). OsmaniAppProvider debounces a
 * soft refresh on these.
 *
 * Keep in sync with admin broadcast conventions (add aliases as backends evolve).
 */
export const ADMIN_SOFT_REFRESH_SSE_EVENTS = Object.freeze([
  'sync',
  'channels_changed',
  'channels_updated',
  'channel_created',
  'channel_updated',
  'channel_deleted',
  'banners_changed',
  'banners_updated',
  'catalog_changed',
  'plans_changed',
  'payment_providers_changed',
  'zenopay_settings_changed',
  'notifications_changed',
]);
