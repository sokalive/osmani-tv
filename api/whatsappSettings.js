import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import { normalizeWhatsappSettings, whatsappPayloadLooksComplete } from '../lib/parseWhatsappSettings';

async function parseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const VIEWER_PATHS = [
  '/api/whatsapp-settings',
  '/api/public/whatsapp-settings',
];

/**
 * Viewer bootstrap for WhatsApp FAB (no admin session).
 * Tries canonical path first (restores instantly when backend re-opens GET),
 * then optional public alias used on hardened admin APIs.
 */
export async function getWhatsappSettingsForViewer() {
  let lastStatus = 0;
  let lastError = '';

  for (const path of VIEWER_PATHS) {
    try {
      const res = await fetch(`${resolveApiBaseUrl()}${path}`);
      const body = await parseJson(res);
      lastStatus = res.status;
      if (!res.ok) {
        if (body && typeof body === 'object' && body.error != null) {
          lastError = String(body.error);
        }
        continue;
      }
      const normalized = normalizeWhatsappSettings(body);
      if (whatsappPayloadLooksComplete(normalized) || normalized.enabled === false) {
        return normalized;
      }
      if (body && typeof body === 'object') {
        return normalized;
      }
    } catch (e) {
      lastError = e?.message ?? String(e);
    }
  }

  const extra = lastError ? ` — ${lastError}` : '';
  throw new Error(
    `Could not load WhatsApp settings (${lastStatus || 'network'})${extra}`,
  );
}
