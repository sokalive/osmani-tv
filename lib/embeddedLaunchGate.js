/**
 * Embedded first-launch OTA gate — blocks Home/channels until OTA is applied.
 * Startup-only; does not modify playback routing.
 */

import * as Updates from 'expo-updates';
import {
  isExpoUpdatesRuntimeEnabled,
  syncExpoUpdateBundle,
} from './expoUpdatesClient';
import { logFirstLaunchBootDiagnostics } from './firstLaunchBootDiagnostics';
import {
  resetEmbeddedOtaProgress,
  setEmbeddedOtaPhase,
} from './embeddedLaunchOtaProgress';

export const EMBEDDED_LAUNCH_CHECK_TIMEOUT_MS = 25_000;
export const EMBEDDED_LAUNCH_FETCH_TIMEOUT_MS = 90_000;
export const EMBEDDED_LAUNCH_MAX_ATTEMPTS = 4;
export const EMBEDDED_LAUNCH_RETRY_DELAY_MS = 2500;

let gatePromise = null;

function logGate(tag, detail) {
  try {
    console.log('[embedded-launch-gate]', tag, detail ?? '');
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @returns {boolean}
 */
export function isEmbeddedLaunchRuntime() {
  if (!isExpoUpdatesRuntimeEnabled()) return false;
  try {
    return Updates.isEmbeddedLaunch === true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runEmbeddedLaunchOtaGate() {
  resetEmbeddedOtaProgress();
  logFirstLaunchBootDiagnostics('gate_start');

  if (!isEmbeddedLaunchRuntime()) {
    logGate('skip', 'not_embedded_launch');
    logFirstLaunchBootDiagnostics('gate_skip_not_embedded');
    return { skipped: true, reason: 'not_embedded' };
  }

  logGate('embedded_launch_detected', {
    runtimeVersion: Updates.runtimeVersion,
    channel: Updates.channel,
    updateId: Updates.updateId,
  });
  logFirstLaunchBootDiagnostics('embedded_launch_detected');

  setEmbeddedOtaPhase('checking');
  logGate('ota_check_started', { maxAttempts: EMBEDDED_LAUNCH_MAX_ATTEMPTS });

  let lastResult = { ok: false, reason: 'boot-embedded' };

  for (let attempt = 1; attempt <= EMBEDDED_LAUNCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      logGate('ota_download_started', { attempt });
      setEmbeddedOtaPhase(attempt === 1 ? 'checking' : 'downloading');

      lastResult = await syncExpoUpdateBundle('boot-embedded', {
        reloadIfNew: true,
        checkTimeoutMs: EMBEDDED_LAUNCH_CHECK_TIMEOUT_MS,
        fetchTimeoutMs: EMBEDDED_LAUNCH_FETCH_TIMEOUT_MS,
        trackProgress: true,
      });

      if (lastResult.embeddedLaunchReload) {
        setEmbeddedOtaPhase('reloading');
        logGate('ota_applied', lastResult);
        logGate('app_reload_automatic', lastResult);
        logFirstLaunchBootDiagnostics('gate_embedded_reload', lastResult);
        return lastResult;
      }

      if (lastResult.skipped && lastResult.reason === 'in_flight') {
        await sleep(500);
        attempt -= 1;
        continue;
      }

      if (lastResult.ok && lastResult.available === false) {
        logGate('ota_not_required', lastResult);
        logFirstLaunchBootDiagnostics('gate_complete_no_update', lastResult);
        return lastResult;
      }

      if (lastResult.ok && lastResult.available === true) {
        logGate('ota_download_completed', lastResult);
        setEmbeddedOtaPhase('applying');
        if (lastResult.isNew === true && Updates.isEmbeddedLaunch === true) {
          setEmbeddedOtaPhase('reloading');
          logGate('ota_applied_manual_reload', lastResult);
          logGate('app_reload_automatic', lastResult);
          await Updates.reloadAsync();
          return { ...lastResult, embeddedLaunchReload: true };
        }
      }

      logGate('attempt_incomplete', { attempt, ...lastResult });
    } catch (e) {
      const err = String(e?.message ?? e);
      logGate('attempt_error', { attempt, error: err });
      lastResult = { ok: false, error: err, attempt };
    }

    if (attempt < EMBEDDED_LAUNCH_MAX_ATTEMPTS) {
      setEmbeddedOtaPhase('checking');
      await sleep(EMBEDDED_LAUNCH_RETRY_DELAY_MS);
    }
  }

  logGate('proceed_after_retries', lastResult);
  logFirstLaunchBootDiagnostics('gate_complete_embedded_no_reload', lastResult);
  return lastResult;
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export function beginEmbeddedLaunchGate() {
  if (!gatePromise) {
    gatePromise = runEmbeddedLaunchOtaGate();
  }
  return gatePromise;
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export function awaitEmbeddedLaunchGate() {
  return gatePromise ?? Promise.resolve({ skipped: true, reason: 'gate_not_started' });
}
