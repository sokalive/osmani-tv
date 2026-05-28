/**
 * Expo EAS Updates (JS bundle OTA) — separate from native APK updates (`lib/updateClient.js`).
 *
 * Safety:
 * - Disabled in __DEV__ and when expo-updates is not enabled (e.g. Expo Go).
 * - Fetches during startup / throttled foreground; never reloads mid-session.
 * - Downloaded bundles apply on the next cold start (no `reloadAsync` during playback).
 * - Failures are caught; the embedded bundle keeps running.
 * - `checkAutomatically: ON_ERROR_RECOVERY` in app.config enables Expo rollback after crash loops.
 */

import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { withTimeout } from './asyncTimeout';

const PREFIX = '[expo-updates]';
/** Throttle resume checks — splash handles cold start. */
const FOREGROUND_RECHECK_MS = 8 * 60 * 60 * 1000;
/** Backup while app stays foreground for hours (launch + resume remain primary). */
const LONG_INTERVAL_RECHECK_MS = 12 * 60 * 60 * 1000;
/** Never block startup/UI waiting on a slow OTA download. */
const SYNC_TIMEOUT_MS = 12_000;

let inFlight = false;
let lastCheckAt = 0;
let lastResult = { at: 0, reason: 'init', ok: true };
let appStateSub = null;
let longIntervalTimer = null;

function log(tag, ...args) {
  if (!__DEV__) return;
  try {
    console.log(PREFIX, tag, ...args);
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
      lastCheck: lastResult,
    };
  } catch (e) {
    return { enabled: true, error: String(e?.message ?? e), lastCheck: lastResult };
  }
}

/**
 * Check EAS for a compatible update (same runtimeVersion) and download if available.
 * Does not reload the running app — applies on next cold start.
 *
 * @param {string} [reason]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function syncExpoUpdateBundle(reason = 'manual') {
  if (!isExpoUpdatesRuntimeEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }
  if (inFlight) {
    return { skipped: true, reason: 'in_flight' };
  }

  inFlight = true;
  const startedAt = Date.now();
  try {
    log('check_start', reason, {
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
      updateId: Updates.updateId,
    });

    const check = await withTimeout(
      Updates.checkForUpdateAsync(),
      SYNC_TIMEOUT_MS,
      'expo-updates-check-timeout',
    );
    if (!check.isAvailable) {
      const out = { ok: true, available: false, reason, elapsedMs: Date.now() - startedAt };
      lastResult = { at: Date.now(), reason, ...out };
      log('check_none', out);
      return out;
    }

    const fetch = await withTimeout(
      Updates.fetchUpdateAsync(),
      SYNC_TIMEOUT_MS,
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
    return out;
  } finally {
    inFlight = false;
    lastCheckAt = Date.now();
  }
}

function maybeForegroundSync() {
  if (!isExpoUpdatesRuntimeEnabled()) return;
  if (AppState.currentState !== 'active') return;
  if (Date.now() - lastCheckAt < FOREGROUND_RECHECK_MS) return;
  void syncExpoUpdateBundle('foreground');
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
      void syncExpoUpdateBundle('long-interval');
    }
    scheduleLongIntervalSync();
  }, LONG_INTERVAL_RECHECK_MS);
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
}
