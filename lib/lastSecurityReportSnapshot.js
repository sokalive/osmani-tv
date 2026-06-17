/** Last successful security-report parse — survives clean-scan dedupe skips. */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'osmani:security_policy_snapshot_v1';

const empty = Object.freeze({
  serverPlaybackAllowed: null,
  serverSecurityBlocked: null,
  smartMonitorEnabled: false,
  enforcement: null,
  playbackGateReason: null,
  at: 0,
});

let snapshot = { ...empty };

/**
 * @param {Partial<typeof empty>} next
 */
export function setLastSecurityReportSnapshot(next) {
  snapshot = { ...snapshot, ...next, at: Date.now() };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => {});
}

export function getLastSecurityReportSnapshot() {
  return snapshot;
}

/**
 * Hydrate in-memory snapshot from disk so Smart Monitor policy survives cold start.
 * @returns {Promise<typeof snapshot>}
 */
export async function loadPersistedSecurityReportSnapshot() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return snapshot;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return snapshot;
    snapshot = {
      ...empty,
      serverPlaybackAllowed:
        parsed.serverPlaybackAllowed === true
          ? true
          : parsed.serverPlaybackAllowed === false
            ? false
            : null,
      serverSecurityBlocked:
        parsed.serverSecurityBlocked === true
          ? true
          : parsed.serverSecurityBlocked === false
            ? false
            : null,
      smartMonitorEnabled: parsed.smartMonitorEnabled === true,
      enforcement: typeof parsed.enforcement === 'string' ? parsed.enforcement : null,
      playbackGateReason:
        typeof parsed.playbackGateReason === 'string' ? parsed.playbackGateReason : null,
      at: Number(parsed.at) || Date.now(),
    };
  } catch {
    /* ignore */
  }
  return snapshot;
}
