/**
 * OTA boot gate — blocks Home/channels until stale JS is replaced via OTA + reload.
 * Startup-only; does not modify playback routing.
 */

import * as Updates from 'expo-updates';
import { syncExpoUpdateBundle } from './expoUpdatesClient';
import { logFirstLaunchBootDiagnostics } from './firstLaunchBootDiagnostics';
import {
  collectOtaBootGateSnapshot,
  isStalePlaybackBundle,
  shouldReloadAfterOtaFetch,
  shouldRunOtaBootGate,
} from './otaBootGatePolicy';
import {
  resetEmbeddedOtaProgress,
  setEmbeddedOtaPhase,
} from './embeddedLaunchOtaProgress';

export const EMBEDDED_LAUNCH_CHECK_TIMEOUT_MS = 25_000;
export const EMBEDDED_LAUNCH_FETCH_TIMEOUT_MS = 90_000;
export const EMBEDDED_LAUNCH_MAX_ATTEMPTS = 4;
export const EMBEDDED_LAUNCH_RETRY_DELAY_MS = 2500;

/** @deprecated use shouldRunOtaBootGate */
export { isEmbeddedLaunchFlag as isEmbeddedLaunchRuntime } from './otaBootGatePolicy';

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
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runEmbeddedLaunchOtaGate() {
  resetEmbeddedOtaProgress();
  const snapshot = collectOtaBootGateSnapshot();
  logGate('gate_evaluated', snapshot);
  logFirstLaunchBootDiagnostics('gate_start', snapshot);

  if (!shouldRunOtaBootGate()) {
    logGate('skip', 'ota_gate_not_required');
    logGate('gate_released', { reason: 'not_required', ...snapshot });
    logFirstLaunchBootDiagnostics('gate_skip_not_required', snapshot);
    return { skipped: true, reason: 'not_required', snapshot };
  }

  logGate('gate_blocking_ui', snapshot);
  logGate('embedded_launch_detected', {
    stalePlaybackBundle: snapshot.stalePlaybackBundle,
    isEmbeddedLaunch: snapshot.updates?.isEmbeddedLaunch,
    runtimeVersion: Updates.runtimeVersion,
    channel: Updates.channel,
    updateId: Updates.updateId,
  });

  const staleAtStart = isStalePlaybackBundle();
  setEmbeddedOtaPhase('checking');
  logGate('ota_check_started', { maxAttempts: EMBEDDED_LAUNCH_MAX_ATTEMPTS, staleAtStart });

  let lastResult = { ok: false, reason: 'boot-embedded' };

  for (let attempt = 1; attempt <= EMBEDDED_LAUNCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      logGate('ota_download_started', { attempt, staleAtStart });
      setEmbeddedOtaPhase(attempt === 1 ? 'checking' : 'downloading');

      lastResult = await syncExpoUpdateBundle('boot-embedded', {
        reloadIfNew: true,
        checkTimeoutMs: EMBEDDED_LAUNCH_CHECK_TIMEOUT_MS,
        fetchTimeoutMs: EMBEDDED_LAUNCH_FETCH_TIMEOUT_MS,
        trackProgress: true,
        staleAtSessionStart: staleAtStart,
      });

      if (lastResult.embeddedLaunchReload) {
        setEmbeddedOtaPhase('reloading');
        logGate('ota_applied', lastResult);
        logGate('ota_reload_triggered', lastResult);
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
        logGate('gate_released', { reason: 'no_update_on_server', ...lastResult });
        logFirstLaunchBootDiagnostics('gate_complete_no_update', lastResult);
        return lastResult;
      }

      if (lastResult.ok && lastResult.available === true && lastResult.isNew === true) {
        logGate('ota_download_completed', lastResult);
        setEmbeddedOtaPhase('applying');
        if (shouldReloadAfterOtaFetch(staleAtStart)) {
          setEmbeddedOtaPhase('reloading');
          logGate('ota_applied_manual_reload', lastResult);
          logGate('ota_reload_triggered', lastResult);
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
  logGate('gate_released', { reason: 'retries_exhausted', ...lastResult });
  logFirstLaunchBootDiagnostics('gate_complete_no_reload', lastResult);
  return lastResult;
}

/**
 * Start gate once (import-time or React mount).
 *
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
  return gatePromise ?? beginEmbeddedLaunchGate();
}
