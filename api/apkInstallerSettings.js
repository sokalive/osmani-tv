import { BASE_URL } from '../api';
import { applyRemoteApkInstallerConfig } from '../lib/apkInstallerConfig';

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
 * Viewer-safe APK installer flags from public/runtime endpoints.
 * @returns {Promise<boolean | null>} remote sideload enabled, or null if unknown
 */
export async function tryGetRemoteApkInstallerSettings() {
  const paths = ['/api/public/app-settings', '/api/public/runtime-modes', '/api/runtime/app-modes'];
  for (const path of paths) {
    try {
      const res = await fetch(`${BASE_URL}${path}`);
      const body = await parseJson(res);
      if (!res.ok || !body) continue;
      const applied = applyRemoteApkInstallerConfig(body);
      if (applied != null) return applied;
    } catch {
      /* ignore */
    }
  }
  return null;
}
