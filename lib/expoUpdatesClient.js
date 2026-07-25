/**
 * Expo EAS Updates (JS bundle OTA) — separate from native APK updates (`lib/updateClient.js`).
 *
 * Safety:
 * - Disabled in __DEV__ and when expo-updates is not enabled (e.g. Expo Go).
 * - Fetches during startup / throttled foreground; never reloads mid-session during playback.
 * - Downloaded bundles normally apply on the next cold start.
 * - Exception: embedded first launch (`isEmbeddedLaunch`) may reload once when
 *   `reloadIfNew` is set and `fetchUpdateAsync()` returns `isNew: true`.
 * - Failures are caught; the embedded bundle keeps running.
 * - `checkAutomatically: ON_ERROR_RECOVERY` in app.config enables Expo rollback after crash loops.
 */

import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { addUpdatesStateChangeListener } from 'expo-updates';
import { withTimeout } from './asyncTimeout';
import {
  setEmbeddedOtaDownloadProgress,
  setEmbeddedOtaPhase,
} from './embeddedLaunchOtaProgress';
import {
  isStalePlaybackBundle,
  hasKifurushiKimekwishaGateRemoved,
  hasKifurushiKimekwishaPopupRemovedV2,
  hasKifurushiKimekwishaPopupRemovedV3,
  hasKifurushiKimekwishaPopupRemovedV4,
} from './otaBootGatePolicy';

const PREFIX = '[expo-updates]';
/** Throttle resume checks when bundle is already current. */
const FOREGROUND_RECHECK_MS = 8 * 60 * 60 * 1000;
/** Stale / pre-popup-fix bundles must hunt OTA frequently so users get reload without reinstall. */
const STALE_FOREGROUND_RECHECK_MS = 45 * 1000;
/** Backup while app stays foreground for hours (launch + resume remain primary). */
const LONG_INTERVAL_RECHECK_MS = 12 * 60 * 60 * 1000;
/** First-session hunt window — keep checking until the popup-removal OTA is applied. */
const SESSION_OTA_HUNT_MS = 45 * 1000;
const SESSION_OTA_HUNT_MAX_MS = 15 * 60 * 1000;
/** Never block startup/UI waiting on a slow OTA download. */
const SYNC_TIMEOUT_MS = 20_000;

let inFlight = false;
let lastCheckAt = 0;
let lastResult = { at: 0, reason: 'init', ok: true };
let appStateSub = null;
let longIntervalTimer = null;
let sessionHuntTimer = null;
let sessionHuntStartedAt = 0;

function log(tag, ...args) {
  if (!__DEV__) return;
  try {
    console.log(PREFIX, tag, ...args);
  } catch {
    /* ignore */
  }
}

function logProd(tag, detail) {
  try {
    console.log(PREFIX, tag, detail ?? '');
  } catch {
    /* ignore */
  }
}

function warn(tag, ...args) {
  try {
    console.warn(PREFIX, tag, ...args);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {boolean}
 */
export function isExpoUpdatesRuntimeEnabled() {
  if (__DEV__) return false;
  try {
    return Updates.isEnabled === true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getExpoUpdatesDiagnostics() {
  if (!isExpoUpdatesRuntimeEnabled()) {
    return {
      enabled: false,
      dev: __DEV__,
      channel: null,
      runtimeVersion: null,
      updateId: null,
      isEmbeddedLaunch: null,
      isEmergencyLaunch: null,
    };
  }
  try {
    return {
      enabled: true,
      dev: false,
      channel: Updates.channel ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: Updates.updateId ?? null,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
      isEmergencyLaunch: Updates.isEmergencyLaunch ?? null,
      createdAt: Updates.createdAt ? String(Updates.createdAt) : null,
      lastCheck: lastResult,
      popupMarkers: {
        v1: hasKifurushiKimekwishaGateRemoved(),
        v2: hasKifurushiKimekwishaPopupRemovedV2(),
        v3: hasKifurushiKimekwishaPopupRemovedV3(),
        v4: hasKifurushiKimekwishaPopupRemovedV4(),
      },
      stalePopupBundle: isPopupRemovalStaleBundle(),
    };
  } catch (e) {
    return { enabled: true, error: String(e?.message ?? e), lastCheck: lastResult };
  }
}

/**
 * Check EAS for a compatible update (same runtimeVersion) and download if available.
 * Normally applies on next cold start; embedded boot may reload when `reloadIfNew`.
 *
 * @param {string} [reason]
 * @param {{
 *   reloadIfNew?: boolean,
 *   timeoutMs?: number,
 *   checkTimeoutMs?: number,
 *   fetchTimeoutMs?: number,
 *   trackProgress?: boolean,
 *   staleAtSessionStart?: boolean,
 * }} [opts]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function syncExpoUpdateBundle(reason = 'manual', opts = {}) {
  if (!isExpoUpdatesRuntimeEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }
  if (inFlight) {
    return { skipped: true, reason: 'in_flight' };
  }

  const checkTimeoutMs =
    Number.isFinite(opts.checkTimeoutMs) && opts.checkTimeoutMs > 0
      ? opts.checkTimeoutMs
      : Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : SYNC_TIMEOUT_MS;
  const fetchTimeoutMs =
    Number.isFinite(opts.fetchTimeoutMs) && opts.fetchTimeoutMs > 0
      ? opts.fetchTimeoutMs
      : Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : SYNC_TIMEOUT_MS;
  const reloadIfNew = opts.reloadIfNew === true;
  const trackProgress = opts.trackProgress === true;
  const staleAtSessionStart =
    opts.staleAtSessionStart === true || isStalePlaybackBundle();

  inFlight = true;
  const startedAt = Date.now();
  /** @type {(() => void) | null} */
  let removeProgressListener = null;

  try {
    log('check_start', reason, {
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
      updateId: Updates.updateId,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    });
    logProd('ota_check_started', { reason, isEmbeddedLaunch: Updates.isEmbeddedLaunch });

    if (trackProgress) {
      setEmbeddedOtaPhase('checking');
      const sub = addUpdatesStateChangeListener((event) => {
        const ctx = event?.context;
        if (!ctx) return;
        if (ctx.isChecking) setEmbeddedOtaPhase('checking');
        if (ctx.isDownloading) {
          setEmbeddedOtaPhase('downloading');
          if (Number.isFinite(ctx.downloadProgress)) {
            setEmbeddedOtaDownloadProgress(ctx.downloadProgress);
          }
        }
        if (ctx.isRestarting) setEmbeddedOtaPhase('reloading');
      });
      removeProgressListener = () => sub.remove();
    }

    const check = await withTimeout(
      Updates.checkForUpdateAsync(),
      checkTimeoutMs,
      'expo-updates-check-timeout',
    );
    if (!check.isAvailable) {
      const out = { ok: true, available: false, reason, elapsedMs: Date.now() - startedAt };
      lastResult = { at: Date.now(), reason, ...out };
      log('check_none', out);
      logProd('ota_check_none', out);
      return out;
    }

    logProd('ota_download_started', { reason });
    if (trackProgress) setEmbeddedOtaPhase('downloading');

    const fetch = await withTimeout(
      Updates.fetchUpdateAsync(),
      fetchTimeoutMs,
      'expo-updates-fetch-timeout',
    );
    const out = {
      ok: true,
      available: true,
      isNew: fetch.isNew === true,
      reason,
      elapsedMs: Date.now() - startedAt,
      appliesOnNextLaunch: true,
    };

    logProd('ota_download_completed', {
      isNew: out.isNew,
      elapsedMs: out.elapsedMs,
    });

    // Trust explicit reloadIfNew. Do NOT also require shouldReloadAfterOtaFetch —
    // VPS embedded builds can report isEmbeddedLaunch=false while still needing
    // an immediate reload to drop the expired-package popup.
    if (reloadIfNew === true && fetch.isNew === true) {
      out.appliesOnNextLaunch = false;
      out.embeddedLaunchReload = true;
      lastResult = { at: Date.now(), reason, ...out };
      if (trackProgress) {
        setEmbeddedOtaPhase('applying');
        setEmbeddedOtaDownloadProgress(1);
      }
      logProd('ota_applied', out);
      logProd('ota_reload_triggered', {
        isEmbeddedLaunch: Updates.isEmbeddedLaunch,
        staleAtSessionStart,
        reason,
      });
      logProd('app_reload_automatic', out);
      await Updates.reloadAsync();
      return out;
    }

    lastResult = { at: Date.now(), reason, ...out };
    log('fetch_ok', out);
    return out;
  } catch (e) {
    const out = {
      ok: false,
      reason,
      error: String(e?.message ?? e),
      elapsedMs: Date.now() - startedAt,
    };
    lastResult = { at: Date.now(), reason, ...out };
    warn('sync_failed', out);
    logProd('ota_sync_failed', out);
    return out;
  } finally {
    if (removeProgressListener) removeProgressListener();
    inFlight = false;
    lastCheckAt = Date.now();
  }
}

function isPopupRemovalStaleBundle() {
  return (
    !hasKifurushiKimekwishaGateRemoved() ||
    !hasKifurushiKimekwishaPopupRemovedV2() ||
    !hasKifurushiKimekwishaPopupRemovedV3() ||
    !hasKifurushiKimekwishaPopupRemovedV4()
  );
}

function maybeForegroundSync() {
  if (!isExpoUpdatesRuntimeEnabled()) return;
  if (AppState.currentState !== 'active') return;
  const stalePopupBundle = isPopupRemovalStaleBundle();
  const throttleMs = stalePopupBundle ? STALE_FOREGROUND_RECHECK_MS : FOREGROUND_RECHECK_MS;
  if (Date.now() - lastCheckAt < throttleMs) return;
  void syncExpoUpdateBundle('foreground', {
    reloadIfNew: true,
    staleAtSessionStart: stalePopupBundle || isStalePlaybackBundle(),
  });
}

function scheduleLongIntervalSync() {
  if (longIntervalTimer) {
    clearTimeout(longIntervalTimer);
    longIntervalTimer = null;
  }
  longIntervalTimer = setTimeout(() => {
    longIntervalTimer = null;
    if (!isExpoUpdatesRuntimeEnabled()) return;
    if (AppState.currentState !== 'active') {
      scheduleLongIntervalSync();
      return;
    }
    if (Date.now() - lastCheckAt >= LONG_INTERVAL_RECHECK_MS) {
      void syncExpoUpdateBundle('long-interval', { reloadIfNew: true });
    }
    scheduleLongIntervalSync();
  }, LONG_INTERVAL_RECHECK_MS);
}

function scheduleSessionOtaHunt() {
  if (sessionHuntTimer) {
    clearTimeout(sessionHuntTimer);
    sessionHuntTimer = null;
  }
  if (!sessionHuntStartedAt) sessionHuntStartedAt = Date.now();
  if (Date.now() - sessionHuntStartedAt > SESSION_OTA_HUNT_MAX_MS) return;
  if (!isPopupRemovalStaleBundle() && !isStalePlaybackBundle()) return;

  sessionHuntTimer = setTimeout(() => {
    sessionHuntTimer = null;
    if (!isExpoUpdatesRuntimeEnabled()) return;
    if (AppState.currentState === 'active') {
      void syncExpoUpdateBundle('session-hunt', {
        reloadIfNew: true,
        staleAtSessionStart: true,
      });
    }
    scheduleSessionOtaHunt();
  }, SESSION_OTA_HUNT_MS);
}

/**
 * Start background EAS Update sync (startup + throttled resume). Safe alongside APK update client.
 * @returns {() => void}
 */
export function startExpoUpdatesClient() {
  if (!isExpoUpdatesRuntimeEnabled()) {
    log('init_skipped', { dev: __DEV__, enabled: Updates.isEnabled });
    return () => {};
  }

  log('init', {
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
  });
  logProd('ota_runtime_snapshot', {
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
    isEmergencyLaunch: Updates.isEmergencyLaunch ?? null,
    createdAt: Updates.createdAt ? String(Updates.createdAt) : null,
    stalePopupBundle: isPopupRemovalStaleBundle(),
    markers: {
      v1: hasKifurushiKimekwishaGateRemoved(),
      v2: hasKifurushiKimekwishaPopupRemovedV2(),
      v3: hasKifurushiKimekwishaPopupRemovedV3(),
      v4: hasKifurushiKimekwishaPopupRemovedV4(),
    },
  });

  // If Expo rolled back to embedded after a crash loop, hunt aggressively —
  // emergency launch is the main way July-6 popup JS comes back after a good OTA.
  if (Updates.isEmergencyLaunch === true) {
    logProd('ota_emergency_launch_detected', {
      updateId: Updates.updateId ?? null,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? null,
    });
  }

  // Immediate hunt — do not wait for 8h throttle. Existing VPS users must
  // receive the popup-removal OTA on a normal open without reinstall.
  void syncExpoUpdateBundle('client-init', {
    reloadIfNew: true,
    staleAtSessionStart: isPopupRemovalStaleBundle() || isStalePlaybackBundle(),
  });
  scheduleSessionOtaHunt();

  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') maybeForegroundSync();
    });
  }
  scheduleLongIntervalSync();

  return () => {
    try {
      appStateSub?.remove?.();
    } catch {
      /* ignore */
    }
    appStateSub = null;
    if (longIntervalTimer) {
      clearTimeout(longIntervalTimer);
      longIntervalTimer = null;
    }
    if (sessionHuntTimer) {
      clearTimeout(sessionHuntTimer);
      sessionHuntTimer = null;
    }
  };
}

export function stopExpoUpdatesClient() {
  try {
    appStateSub?.remove?.();
  } catch {
    /* ignore */
  }
  appStateSub = null;
  if (longIntervalTimer) {
    clearTimeout(longIntervalTimer);
    longIntervalTimer = null;
  }
  if (sessionHuntTimer) {
    clearTimeout(sessionHuntTimer);
    sessionHuntTimer = null;
  }
}
