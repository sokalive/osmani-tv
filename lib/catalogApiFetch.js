import { LEGACY_API_HOSTS, resolveApiBaseUrl } from './apiBaseUrl';

/** Emergency HTTPS mirror when Contabo HTTP is blocked by Android cleartext policy (OTA-only relief). */
const HTTPS_TRANSPORT_FALLBACK = LEGACY_API_HOSTS[0];

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
  console.log(`[${tag}]`, JSON.stringify({ phase: 'request', url, base, mode: opts.mode ?? 'primary' }));

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
      mode: opts.mode ?? 'primary',
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
 * @param {string} path
 * @param {{ tag?: string; method?: string; body?: unknown }} [opts]
 */
export async function fetchAdminApiJson(path, opts = {}) {
  const primary = resolveApiBaseUrl();
  const bases =
    primary.startsWith('http://') && HTTPS_TRANSPORT_FALLBACK.startsWith('https://')
      ? [primary, HTTPS_TRANSPORT_FALLBACK]
      : [primary];
  let lastError = null;

  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i];
    const mode = i === 0 ? 'primary' : 'https-fallback';
    try {
      return await fetchAdminApiJsonOnce(base, path, { ...opts, mode });
    } catch (err) {
      lastError = err;
      const canFallback = i === 0 && bases.length > 1 && isNetworkTransportError(err);
      if (!canFallback) throw err;
      console.log(
        `[${opts.tag ?? 'api-fetch'}]`,
        JSON.stringify({
          phase: 'fallback',
          from: primary,
          to: HTTPS_TRANSPORT_FALLBACK,
          reason: String(err?.message ?? err),
        }),
      );
    }
  }
  throw lastError ?? new Error('api_fetch_failed');
}
