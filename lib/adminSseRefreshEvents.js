/**
 * SSE `event:` names the Admin API may emit when public catalog or commerce
 * metadata changes. Listed here so {@link ../lib/realtimeSync} registers
 * listeners (unknown names never reach JS). OsmaniAppProvider debounces a
 * soft refresh on these.
 *
 * Keep in sync with admin broadcast conventions (add aliases as backends evolve).
 */
/** Subscription / payment activation — immediate reverify (no catalog debounce). */
export const SUBSCRIPTION_SSE_EVENTS = Object.freeze([
  'subscription_activated',
  'subscription_granted',
  'subscription_changed',
  'subscription_updated',
  'subscription_status_changed',
  'subscription_renewed',
  'payment_success',
  'payment_completed',
  'manual_subscription_granted',
]);

/** Admin APK / Play update settings — handled by updateClient; listed for stream registration. */
export const UPDATE_SETTINGS_SSE_EVENTS = Object.freeze([
  'app_version_changed',
  'app_version',
  'update',
  'update_settings_changed',
  'update_settings',
]);

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
  'aurax_settings_changed',
  'sonicpesa_settings_changed',
  'notifications_changed',
]);

/** Free / emergency / maintenance toggles — apply immediately on Android (no debounce). */
export const ADMIN_RUNTIME_MODE_SSE_EVENTS = Object.freeze([
  'app_modes_changed',
  'runtime_modes_changed',
  'config_changed',
  'runtime_config_changed',
  'trial_watch_changed',
  'trial_watch_settings_changed',
]);

/**
 * Users Intelligence device block/unblock — refresh access immediately (no 90s wait).
 */
export const DEVICE_INTELLIGENCE_SSE_EVENTS = Object.freeze([
  'device_blocked',
  'device_unblocked',
  'user_blocked',
  'user_unblocked',
  'users_intelligence_changed',
  'user_device_blocked',
  'user_device_unblocked',
  'user_device_status_changed',
  'device_status_changed',
  'registry_updated',
  'device_registry_updated',
  'smart_monitor_enabled',
  'smart_monitor_disabled',
  'device_smart_monitor_enabled',
  'device_smart_monitor_disabled',
]);
