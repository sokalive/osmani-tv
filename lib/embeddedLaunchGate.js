/**
 * Blocks app UI on first install until EAS OTA is checked, downloaded, and applied.
 * Must start from startupSplashBoot (imported before React) — not from useEffect.
 */

import * as Updates from 'expo-updates';
import {
  isExpoUpdatesRuntimeEnabled,
  syncExpoUpdateBundle,
} from './expoUpdatesClient';

/** Fresh install: allow check + download on slow networks before exposing Home. */
export const EMBEDDED_LAUNCH_OTA_TIMEOUT_MS = 30_000;
export const EMBEDDED_LAUNCH_OTA_RETRIES = 2;

let gatePromise = null;

function logBoot(tag, detail) {
  try {
    console.log('[embedded-launch-gate]', tag, detail ?? '');
  } catch {
    /* ignore */
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start gate as early as possible (module import). Resolves when it is safe to
 * render Home / open channels, or triggers reloadAsync when a new OTA bundle
 * was downloaded on embedded launch.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
export function beginEmbeddedLaunchGate() {
  if (gatePromise) return gatePromise;

  gatePromise = (async () => {
    if (!isEmbeddedLaunchRuntime()) {
      logBoot('skip', 'not embedded launch');
      return { skipped: true, reason: 'not_embedded' };
    }

    logBoot('start', {
      runtimeVersion: Updates.runtimeVersion,
      channel: Updates.channel,
      updateId: Updates.updateId,
    });

    let lastResult = { ok: false, reason: 'boot-embedded' };
    for (let attempt = 1; attempt <= EMBEDDED_LAUNCH_OTA_RETRIES; attempt += 1) {
      try {
        lastResult = await syncExpoUpdateBundle('boot-embedded', {
          applyOnEmbeddedLaunch: true,
          timeoutMs: EMBEDDED_LAUNCH_OTA_TIMEOUT_MS,
        });

        if (lastResult.embeddedLaunchReload) {
          logBoot('reload', lastResult);
          return lastResult;
        }

        if (lastResult.skipped && lastResult.reason === 'in_flight') {
          await sleep(400);
          continue;
        }

        if (lastResult.ok) {
          logBoot('ready', { attempt, ...lastResult });
          return lastResult;
        }

        logBoot('attempt_failed', { attempt, ...lastResult });
      } catch (e) {
        logBoot('attempt_error', { attempt, error: String(e?.message ?? e) });
        lastResult = { ok: false, error: String(e?.message ?? e), attempt };
      }

      if (attempt < EMBEDDED_LAUNCH_OTA_RETRIES) {
        await sleep(1500);
      }
    }

    logBoot('proceed_embedded', lastResult);
    return lastResult;
  })();

  return gatePromise;
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export function awaitEmbeddedLaunchGate() {
  return gatePromise ?? Promise.resolve({ skipped: true, reason: 'gate_not_started' });
}
