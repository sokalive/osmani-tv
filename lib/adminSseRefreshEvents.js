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
  'entitlement_changed',
  'payment_success',
  'payment_completed',
  'manual_subscription_granted',
]);

/**
 * Legacy/backend aliases for admin manual grants (Toa Kifurushi) and per-device updates.
 * Listed on both /api/sync/stream and /api/subscription-stream listeners.
 */
export const MANUAL_SUBSCRIPTION_SSE_ALIASES = Object.freeze([
  'device_subscription',
  'device_subscription_granted',
  'device_subscription_updated',
  'manual_subscription',
  'manual_subscription_changed',
  'package_granted',
  'admin_subscription_granted',
  'analytics_subscription_updated',
  /** Backend manualGrantRealtime (cea3d5c+) — Hongera hint + wake */
  'manual_gift',
  'subscription_wake',
  'subscription_manual_grant',
  /** Admin approved OMBA KIFURUSHI / payment recovery — wake verify */
  'subscription_request_updated',
]);

/** All subscription wake-up SSE names (canonical + aliases). */
export const SUBSCRIPTION_WAKE_SSE_EVENTS = Object.freeze([
  ...SUBSCRIPTION_SSE_EVENTS,
  ...MANUAL_SUBSCRIPTION_SSE_ALIASES,
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
  'catalog_refresh',
  'channels_changed',
  'channels_updated',
  'channel_created',
  'channel_updated',
  'channel_deleted',
  'channel_access_changed',
  'access_type_changed',
  'channel_access_updated',
  'banners_changed',
  'banners_updated',
  'banner_changed',
  'banner_updated',
  'banner_created',
  'banner_deleted',
  'catalog_changed',
  'plans_changed',
  'payment_providers_changed',
  'zenopay_settings_changed',
  'aurax_settings_changed',
  'sonicpesa_settings_changed',
  'notifications_changed',
  'omba_kifurushi_settings_changed',
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

/**
 * Admin User Center profile changes — immediate subscription + device refresh.
 */
export const USER_CENTER_SSE_EVENTS = Object.freeze([
  'user_profile_changed',
  'user_center_updated',
  'user_center_sync',
  'subscription_repaired',
  'subscription_repair',
  'device_repaired',
  'device_repair',
  'device_migrated',
  'device_migration',
  'package_changed',
  'user_package_changed',
  'user_device_repaired',
  'user_subscription_repaired',
]);

/**
 * Admin DELETE USER / remove device — must clear Premium instantly (no restart).
 * Backend may emit any of these aliases; all map to local entitlement wipe + reverify.
 */
export const DELETE_USER_SSE_EVENTS = Object.freeze([
  'user_deleted',
  'device_deleted',
  'device_removed',
  'user_removed',
  'subscription_deleted',
  'admin_user_deleted',
  'delete_user',
  'user_device_deleted',
  'device_purged',
  'user_purged',
]);
