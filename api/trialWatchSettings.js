import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
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
 * Viewer-safe trial settings from runtime API (never admin-only routes).
 * Returns null when no endpoint provides explicit trial flags (fail-closed upstream).
 * @returns {Promise<ReturnType<typeof parseTrialWatchSettings> | null>}
 */
export async function tryGetViewerTrialWatchSettings() {
  const paths = [
    '/api/runtime/trial-watch',
    '/api/public/trial-watch',
    '/api/public/trial-watch-settings',
  ];
  for (const path of paths) {
    try {
      const res = await fetch(`${resolveApiBaseUrl()}${path}`);
      const body = await parseJson(res);
      if (!res.ok || !body) continue;
      const parsed = parseTrialWatchSettings(body);
      if (parsed.configLoaded) return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
}
