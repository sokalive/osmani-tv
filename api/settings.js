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

/**
 * Global app flags from admin (Free / Emergency / Maintenance) plus the
 * Lovable-style banner engine threshold config (`banner_engine`).
 *
 * GET /api/settings
 *
 * Backwards-compatible: if the backend hasn't deployed the
 * `banner_engine` block yet, the field is null and the mobile engine
 * falls back to its built-in defaults via `mergeEngineConfig(null)`.
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

  const bannerEngineRaw = body.banner_engine ?? body.bannerEngine ?? null;
  const bannerEngine =
    bannerEngineRaw && typeof bannerEngineRaw === 'object' ? bannerEngineRaw : null;

  return {
    freeMode: Boolean(body.freeMode),
    emergencyMode: Boolean(body.emergencyMode),
    maintenanceMode: Boolean(body.maintenanceMode),
    bannerEngine,
  };
}
