/**
 * Temporary first-launch trial investigation traces.
 * Filter device logs: adb logcat | findstr TRIAL_TRACE
 * Remove after root cause is confirmed.
 */

const PREFIX = '[TRIAL_TRACE]';

let seq = 0;

function stamp() {
  seq += 1;
  return seq;
}

/**
 * @param {string} step
 * @param {Record<string, unknown>} [data]
 */
export function trialTrace(step, data = {}) {
  try {
    console.log(PREFIX, `#${stamp()}`, step, {
      ts: Date.now(),
      ...data,
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {typeof import('./trialWatchSettings.shared').DEFAULT_TRIAL_WATCH_SETTINGS} settings
 */
export function trialSettingsSnapshot(settings) {
  if (!settings) return null;
  return {
    enableTrial: settings.enableTrial,
    trialMinutes: settings.trialMinutes,
    previewSeconds: settings.previewSeconds,
    enablePreviewAfterTrial: settings.enablePreviewAfterTrial,
  };
}
