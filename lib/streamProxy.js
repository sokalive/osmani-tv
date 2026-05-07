import { BASE_URL } from '../api';

/**
 * Resolves the stream-proxy base.
 *
 * Priority:
 *   1. EXPO_PUBLIC_STREAM_PROXY_URL (e.g. "https://proxy.example.com/stream-proxy")
 *   2. `${BASE_URL}/stream-proxy` (default Admin API host)
 */
function resolveStreamProxyBase() {
  try {
    const env = typeof process !== 'undefined' ? process.env : undefined;
    const v = env?.EXPO_PUBLIC_STREAM_PROXY_URL;
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\/+$/, '');
  } catch {}
  return `${BASE_URL.replace(/\/+$/, '')}/stream-proxy`;
}

export const STREAM_PROXY_BASE = resolveStreamProxyBase();

/**
 * Build a tokenized-IPTV-safe proxy URL for an HLS manifest.
 *
 * The proxy is responsible for forwarding Referer / Origin / User-Agent on the
 * upstream request and for rewriting variant/segment URLs (so subsequent .ts
 * fetches also flow through the same proxy).
 *
 * Convention used by the app:
 *   {PROXY_BASE}?url=<encoded m3u8>&referer=<encoded>&origin=<encoded>&ua=<encoded>
 *
 * Empty header values are omitted.
 *
 * @param {string} streamUrl
 * @param {{ referer?: string, origin?: string, userAgent?: string }} [headers]
 */
export function buildHlsProxyUrl(streamUrl, headers = {}) {
  const u = String(streamUrl ?? '').trim();
  if (!u) return '';
  const params = new URLSearchParams();
  params.set('url', u);
  if (headers?.referer) params.set('referer', String(headers.referer));
  if (headers?.origin) params.set('origin', String(headers.origin));
  if (headers?.userAgent) params.set('ua', String(headers.userAgent));
  return `${STREAM_PROXY_BASE}?${params.toString()}`;
}
