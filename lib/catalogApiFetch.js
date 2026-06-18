import { resolveApiBaseUrl } from './apiBaseUrl';

/**
 * @param {unknown} errorLike
 * @returns {boolean}
 */
export function isNetworkTransportError(errorLike) {
  const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('networkerror') ||
    msg.includes('failed to fetch') ||
    msg.includes('cleartext') ||
    msg.includes('not permitted') ||
    msg.includes('timeout') ||
    msg.includes('startup-channels') ||
    msg.includes('startup-banners')
  );
}

/**
 * @param {string} base
 * @param {string} path
 * @param {{ tag?: string; method?: string; body?: unknown; mode?: string }} opts
 */
async function fetchAdminApiJsonOnce(base, path, opts = {}) {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const tag = opts.tag ?? 'api-fetch';
  const startedAt = Date.now();
  console.log(`[${tag}]`, JSON.stringify({ phase: 'request', url, base, mode: opts.mode ?? 'contabo' }));

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  console.log(
    `[${tag}]`,
    JSON.stringify({
      phase: 'response',
      url,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - startedAt,
      mode: opts.mode ?? 'contabo',
      bodyPreview: text?.slice?.(0, 120) ?? '',
    }),
  );
  if (!res.ok) {
    const extra =
      parsed && typeof parsed === 'object' && parsed.error != null
        ? ` — ${String(parsed.error)}`
        : '';
    throw new Error(`HTTP ${res.status}${extra}`);
  }
  return parsed;
}

/**
 * Contabo-only Admin API JSON fetch (no Render fallback).
 *
 * @param {string} path
 * @param {{ tag?: string; method?: string; body?: unknown }} [opts]
 */
export async function fetchAdminApiJson(path, opts = {}) {
  const base = resolveApiBaseUrl();
  return fetchAdminApiJsonOnce(base, path, { ...opts, mode: 'contabo' });
}
