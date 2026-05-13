import { BASE_URL } from '../api';

async function parseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeAppFlags(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    freeMode: Boolean(body.freeMode),
    emergencyMode: Boolean(body.emergencyMode),
    maintenanceMode: Boolean(body.maintenanceMode),
  };
}

/**
 * Global app flags from admin (Free / Emergency / Maintenance).
 * GET /api/settings — may require admin session on hardened APIs.
 */
export async function getSettings() {
  const res = await fetch(`${BASE_URL}/api/settings`);
  const body = await parseJson(res);
  if (!res.ok) {
    const err = body && typeof body === 'object' && body.error != null ? String(body.error) : '';
    throw new Error(`Could not load settings (${res.status})${err ? ` — ${err}` : ''}`);
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load settings (invalid response)');
  }
  return normalizeAppFlags(body);
}

/**
 * Viewer / APK bootstrap: same flags as {@link getSettings} but never throws.
 * Tries an unauthenticated public route first (when deployed), then `/api/settings`.
 * Returns `null` if no route succeeds — callers keep defaults or last-known flags.
 */
export async function tryGetViewerAppSettings() {
  const tryPath = async (path) => {
    try {
      const res = await fetch(`${BASE_URL}${path}`);
      const body = await parseJson(res);
      if (!res.ok) return null;
      return normalizeAppFlags(body);
    } catch {
      return null;
    }
  };
  const pub = await tryPath('/api/public/app-settings');
  if (pub) return pub;
  return tryPath('/api/settings');
}
