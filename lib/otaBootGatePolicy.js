/**
 * When to block Home/playback for OTA — based on running bundle capability,
 * not only Updates.isEmbeddedLaunch (unreliable on some devices).
 */

import * as Updates from 'expo-updates';
import { probeStreamDirectRoutingCapability } from './firstLaunchBootDiagnostics';
import { isExpoUpdatesRuntimeEnabled } from './expoUpdatesClient';
import { isPlayStoreVpsBuild, probeApiHostRouting } from './playVpsApiHost';
import { resolveApiBaseUrl } from './apiBaseUrl';

/**
 * True when a downloaded OTA bundle is already running (not the embedded APK JS).
 *
 * @returns {boolean}
 */
export function isRunningDownloadedOtaBundle() {
  if (!isExpoUpdatesRuntimeEnabled()) return false;
  try {
    return Updates.isEmbeddedLaunch !== true && Boolean(Updates.updateId);
  } catch {
    return false;
  }
}

/**
 * True when the running JS bundle lacks stream-direct fixes (Play Store embedded b20bfc5 or old OTA).
 *
 * @returns {boolean}
 */
export function isStalePlaybackBundle() {
  const probe = probeStreamDirectRoutingCapability();
  if (probe.staleEmbeddedLikely === true) return true;
  if (probe.hasStreamDirectExempt === false) return true;
  return false;
}

/**
 * @returns {boolean}
 */
export function isEmbeddedLaunchFlag() {
  if (!isExpoUpdatesRuntimeEnabled()) return false;
  try {
    return Updates.isEmbeddedLaunch === true;
  } catch {
    return false;
  }
}

/**
 * Stale JS still resolves admin API to Render on a Play build that should use VPS (vc >= 16).
 *
 * @returns {boolean}
 */
export function isStaleApiHostBundle() {
  if (!isPlayStoreVpsBuild()) return false;
  try {
    const probe = probeApiHostRouting(resolveApiBaseUrl());
    return probe.ok === false;
  } catch {
    return true;
  }
}

/**
 * Block UI and run OTA sync before Home when playback would fail on stale JS.
 *
 * @returns {boolean}
 */
export function shouldRunOtaBootGate() {
  if (!isExpoUpdatesRuntimeEnabled()) return false;
  /** Never block Home when a production OTA bundle is already active. */
  if (isRunningDownloadedOtaBundle()) return false;
  if (isStaleApiHostBundle()) return true;
  if (isStalePlaybackBundle()) return true;
  if (isEmbeddedLaunchFlag()) return true;
  return false;
}

/**
 * After a successful OTA fetch, reload when the session started on stale JS.
 *
 * @param {boolean} [staleAtSessionStart]
 * @returns {boolean}
 */
export function shouldReloadAfterOtaFetch(staleAtSessionStart = isStalePlaybackBundle()) {
  if (!isExpoUpdatesRuntimeEnabled()) return false;
  if (staleAtSessionStart) return true;
  if (isEmbeddedLaunchFlag()) return true;
  return false;
}

/**
 * @returns {Record<string, unknown>}
 */
export function collectOtaBootGateSnapshot() {
  const routing = probeStreamDirectRoutingCapability();
  let updatesMeta = {
    enabled: isExpoUpdatesRuntimeEnabled(),
    isEmbeddedLaunch: null,
    updateId: null,
  };
  if (updatesMeta.enabled) {
    try {
      updatesMeta = {
        enabled: true,
        isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
        updateId: Updates.updateId ?? null,
        runtimeVersion: Updates.runtimeVersion ?? null,
        channel: Updates.channel ?? null,
      };
    } catch (e) {
      updatesMeta.error = String(e?.message ?? e);
    }
  }
  const staleApi = isStaleApiHostBundle();
  const stale = isStalePlaybackBundle();
  const shouldBlock = shouldRunOtaBootGate();
  return {
    updates: updatesMeta,
    routing,
    staleApiHostBundle: staleApi,
    resolvedApiBaseUrl: (() => {
      try {
        return resolveApiBaseUrl();
      } catch {
        return null;
      }
    })(),
    stalePlaybackBundle: stale,
    shouldRunOtaBootGate: shouldBlock,
    gateWouldSkipWithEmbeddedOnlyCheck:
      updatesMeta.isEmbeddedLaunch !== true && stale === true,
  };
}
