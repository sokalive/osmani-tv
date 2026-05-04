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
 * Global app flags from admin (Free / Emergency / Maintenance).
 * GET /api/settings
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
  return {
    freeMode: Boolean(body.freeMode),
    emergencyMode: Boolean(body.emergencyMode),
    maintenanceMode: Boolean(body.maintenanceMode),
  };
}
