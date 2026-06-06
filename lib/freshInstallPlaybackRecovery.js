/**
 * Fresh-install playback recovery when stale embedded JS hits CDN stream-direct /
 * subscriptions.php errors. Triggers same-session OTA download + reload.
 */

import * as Updates from 'expo-updates';
import {
  isExpoUpdatesRuntimeEnabled,
  syncExpoUpdateBundle,
} from './expoUpdatesClient';
import { isStreamDirectUrl, repairStreamDirectApiHost } from './mediaDelivery';

let recoveryInFlight = false;

/**
 * @param {unknown} input
 * @returns {string}
 */
export function sanitizePlaybackUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (isStreamDirectUrl(s)) return repairStreamDirectApiHost(s);
  return s;
}

/**
 * @param {unknown} reason
 * @returns {boolean}
 */
export function isStaleFirstLaunchPlaybackError(reason) {
  const r = String(reason ?? '');
  return (
    /subscriptions\.php/i.test(r) ||
    /Route not found/i.test(r) ||
    /b-cdn\.net\/stream-direct/i.test(r) ||
    /embed-http:404/i.test(r)
  );
}

/**
 * @param {unknown} uri
 * @returns {boolean}
 */
export function isUnsafeFirstLaunchPlaybackUri(uri) {
  const s = String(uri ?? '').trim();
  if (!s) return false;
  if (/b-cdn\.net\/stream-direct/i.test(s)) return true;
  if (isStreamDirectUrl(s) && !/osmani-admin-api\.onrender\.com/i.test(s)) return true;
  return false;
}

/**
 * Download + apply OTA once when first-launch playback fails with stale routing.
 *
 * @param {string} reason
 * @returns {Promise<boolean>} true when reloadAsync was invoked
 */
export async function tryFreshInstallPlaybackOtaRecovery(reason = '') {
  if (!isExpoUpdatesRuntimeEnabled() || recoveryInFlight) return false;
  if (!isStaleFirstLaunchPlaybackError(reason)) return false;

  recoveryInFlight = true;
  try {
    console.log('[fresh-install-recovery]', 'start', reason);
    const result = await syncExpoUpdateBundle('playback-stale-routing', {
      applyOnEmbeddedLaunch: true,
      timeoutMs: 30_000,
    });
    if (result.embeddedLaunchReload || result.forcedEmbeddedReload) {
      return true;
    }
    if (result.available === true) {
      console.log('[fresh-install-recovery]', 'force_reload_after_fetch', result);
      await Updates.reloadAsync();
      return true;
    }
    console.log('[fresh-install-recovery]', 'no_ota_available', result);
    return false;
  } catch (e) {
    console.log('[fresh-install-recovery]', 'failed', e?.message ?? e);
    return false;
  } finally {
    recoveryInFlight = false;
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} channel
 * @returns {Record<string, unknown> | null | undefined}
 */
export function sanitizeChannelPlaybackFields(channel) {
  if (!channel || typeof channel !== 'object') return channel;
  const next = { ...channel };
  const urlKeys = [
    'url',
    'stream_url',
    'directStreamUrl',
    'direct_stream_url',
    'proxyFallbackUrl',
    'proxy_fallback_url',
    'backupStream1',
    'backup_stream_1',
    'backupStream2',
    'backup_stream_2',
  ];
  for (const key of urlKeys) {
    if (next[key] != null) {
      const fixed = sanitizePlaybackUrl(next[key]);
      if (fixed) next[key] = fixed;
    }
  }
  return next;
}
