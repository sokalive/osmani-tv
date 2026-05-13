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
 * Merge admin app flags from SSE / realtime envelopes (outer frame, nested
 * `payload`, `settings`, snake_case DB fields). Used so Android updates
 * immediately without calling protected GET /api/settings.
 *
 * @param {unknown} payload
 * @returns {{ freeMode?: boolean, emergencyMode?: boolean, maintenanceMode?: boolean } | null}
 */
export function parseAppSettingsRealtimePatch(payload) {
  const candidates = [];
  const push = (x) => {
    if (x && typeof x === 'object' && !candidates.includes(x)) candidates.push(x);
  };
  push(payload);
  if (payload && typeof payload === 'object') {
    push(payload.payload);
    push(payload.data);
    push(payload.settings);
    push(payload.current_settings);
    push(payload.app_settings);
  }
  /** @type {{ freeMode?: boolean, emergencyMode?: boolean, maintenanceMode?: boolean }} */
  const out = {};
  for (const o of candidates) {
    if ('freeMode' in o || 'free_mode' in o) {
      out.freeMode = Boolean(o.freeMode ?? o.free_mode);
    }
    if ('emergencyMode' in o || 'emergency_mode' in o) {
      out.emergencyMode = Boolean(o.emergencyMode ?? o.emergency_mode);
    }
    if ('maintenanceMode' in o || 'maintenance_mode' in o) {
      out.maintenanceMode = Boolean(o.maintenanceMode ?? o.maintenance_mode);
    }
  }
  return Object.keys(out).length ? out : null;
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
 * Viewer / APK bootstrap: public app flags only (never calls admin GET /api/settings).
 * Prefer live values from {@link parseAppSettingsRealtimePatch} + SSE; optional cold start
 * when GET /api/public/app-settings is deployed.
 */
export async function tryGetViewerAppSettings() {
  try {
    const res = await fetch(`${BASE_URL}/api/public/app-settings`);
    const body = await parseJson(res);
    if (!res.ok) return null;
    return normalizeAppFlags(body);
  } catch {
    return null;
  }
}
