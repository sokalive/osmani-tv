/**
 * Blocks app UI on fresh install (embedded launch) until EAS OTA is checked,
 * downloaded, and applied via reloadAsync when fetch.isNew === true.
 *
 * Startup-only — does not modify playback routing.
 */

import * as Updates from 'expo-updates';
import {
  isExpoUpdatesRuntimeEnabled,
  syncExpoUpdateBundle,
} from './expoUpdatesClient';
import { logFirstLaunchBootDiagnostics } from './firstLaunchBootDiagnostics';

/** Fresh install: allow check + download on slow networks before exposing Home. */
export const EMBEDDED_LAUNCH_OTA_TIMEOUT_MS = 30_000;

let gatePromise = null;

function logGate(tag, detail) {
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

/**
 * Start gate as early as possible (module import). Resolves when it is safe to
 * render Home, or triggers reloadAsync when a new OTA bundle was downloaded.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
export function beginEmbeddedLaunchGate() {
  if (gatePromise) return gatePromise;

  gatePromise = (async () => {
    logFirstLaunchBootDiagnostics('gate_start');

    if (!isEmbeddedLaunchRuntime()) {
      logGate('skip', 'not_embedded_launch');
      logFirstLaunchBootDiagnostics('gate_skip_not_embedded');
      return { skipped: true, reason: 'not_embedded' };
    }

    logGate('start', {
      runtimeVersion: Updates.runtimeVersion,
      channel: Updates.channel,
      updateId: Updates.updateId,
    });

    try {
      const result = await syncExpoUpdateBundle('boot-embedded', {
        reloadIfNew: true,
        timeoutMs: EMBEDDED_LAUNCH_OTA_TIMEOUT_MS,
      });

      if (result.embeddedLaunchReload) {
        logGate('reload', result);
        logFirstLaunchBootDiagnostics('gate_embedded_reload', result);
        return result;
      }

      logGate('complete', result);
      logFirstLaunchBootDiagnostics('gate_complete_embedded_no_reload', result);
      return result;
    } catch (e) {
      const err = String(e?.message ?? e);
      logGate('error', err);
      logFirstLaunchBootDiagnostics('gate_error', { error: err });
      return { ok: false, error: err };
    }
  })();

  return gatePromise;
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export function awaitEmbeddedLaunchGate() {
  return gatePromise ?? Promise.resolve({ skipped: true, reason: 'gate_not_started' });
}
