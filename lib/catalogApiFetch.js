import { LEGACY_HTTPS_API_FALLBACK, isVpsApiTarget, resolveApiBaseUrl } from './apiBaseUrl';
import { isPlayStoreVpsBuild, isRenderHostUrl, probeApiHostRouting, guardProductionFetchUrl } from './playVpsApiHost';

let loggedApiHostProbe = false;

function logApiHostOnce(resolvedBase) {
  if (loggedApiHostProbe) return;
  loggedApiHostProbe = true;
  const probe = probeApiHostRouting(resolvedBase);
  console.log(
    '[api-host]',
    JSON.stringify({
      resolvedBase,
      host: probe.host,
      versionCode: probe.versionCode,
      playVpsBuild: probe.forcedVps,
      routingOk: probe.ok,
    }),
  );
  if (!probe.ok) {
    console.error('[api-host]', 'BLOCKED stale Render routing on Play VPS build', probe);
  }
}

function guardFetchUrl(url, base, tag) {
  guardProductionFetchUrl(url, tag);
}

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
 * Admin API fetch targets. VPS Play builds use api.osmanitv.com only — never Render.
 * Legacy Render APKs keep Render primary; cleartext HTTP builds may mirror to HTTPS Render.
 *
 * @returns {string[]}
 */
export function getAdminApiBases() {
  const primary = resolveApiBaseUrl();
  const bases = [primary];

  if (
    !isVpsApiTarget() &&
    primary.startsWith('http://') &&
    LEGACY_HTTPS_API_FALLBACK.startsWith('https://')
  ) {
    bases.push(LEGACY_HTTPS_API_FALLBACK);
  }

  return [...new Set(bases.map((b) => b.replace(/\/+$/, '')))];
}

/**
 * @param {string} base
 * @param {string} path
 * @param {{ tag?: string; method?: string; body?: unknown; mode?: string; headers?: Record<string, string> }} opts
 */
async function fetchAdminApiOnce(base, path, opts = {}) {
  logApiHostOnce(base);
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const tag = opts.tag ?? 'api-fetch';
  guardFetchUrl(url, base, tag);
  const startedAt = Date.now();
  const mode = opts.mode ?? 'primary';
  console.log(`[${tag}]`, JSON.stringify({ phase: 'request', url, base, mode }));

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.body != null ? { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) } : {}),
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
      mode,
      bodyPreview: text?.slice?.(0, 120) ?? '',
    }),
  );
  return { res, parsed, text, url, mode, base };
}

/**
 * @param {string} path
 * @param {{ tag?: string; method?: string; body?: unknown; headers?: Record<string, string> }} [opts]
 */
export async function fetchAdminApiResponse(path, opts = {}) {
  const bases = getAdminApiBases();
  let lastError = null;

  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i];
    const mode = i === 0 ? 'primary' : 'legacy-https-fallback';
    try {
      return await fetchAdminApiOnce(base, path, { ...opts, mode });
    } catch (err) {
      lastError = err;
      const canFallback = i === 0 && bases.length > 1 && isNetworkTransportError(err);
      if (!canFallback) throw err;
      console.log(
        `[${opts.tag ?? 'api-fetch'}]`,
        JSON.stringify({
          phase: 'fallback',
          from: base,
          to: bases[1],
          reason: String(err?.message ?? err),
        }),
      );
    }
  }
  throw lastError ?? new Error('api_fetch_failed');
}

/**
 * @param {string} path
 * @param {{ tag?: string; method?: string; body?: unknown }} [opts]
 */
export async function fetchAdminApiJson(path, opts = {}) {
  const { res, parsed } = await fetchAdminApiResponse(path, opts);
  if (!res.ok) {
    const extra =
      parsed && typeof parsed === 'object' && parsed.error != null
        ? ` — ${String(parsed.error)}`
        : '';
    throw new Error(`HTTP ${res.status}${extra}`);
  }
  return parsed;
}
