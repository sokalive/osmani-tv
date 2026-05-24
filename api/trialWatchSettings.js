import { BASE_URL } from '../api';
import { parseTrialWatchSettings } from '../lib/trialWatchSettings.shared';

async function parseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Viewer-safe trial settings (never calls admin-only routes).
 * @returns {Promise<import('../lib/trialWatchSettings.shared').DEFAULT_TRIAL_WATCH_SETTINGS | null>}
 */
export async function tryGetViewerTrialWatchSettings() {
  const paths = [
    '/api/public/trial-watch',
    '/api/public/trial-watch-settings',
    '/api/runtime/app-modes',
    '/api/public/app-settings',
  ];
  for (const path of paths) {
    try {
      const res = await fetch(`${BASE_URL}${path}`);
      const body = await parseJson(res);
      if (!res.ok || !body) continue;
      return parseTrialWatchSettings(body);
    } catch {
      /* ignore */
    }
  }
  return null;
}
