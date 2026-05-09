/**
 * IP-only geolocation for analytics/presence payloads (no GPS, no prompts).
 * Uses outbound HTTPS lookups; the service infers geo from the client IP.
 *
 * Non-blocking: first read returns locale-only immediately; IP lookup runs once
 * in the background and updates the session cache for later heartbeats.
 */

function localeCountryCodeUpper() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const parts = String(locale).replace('_', '-').split('-');
    const region = parts.length >= 2 ? parts[parts.length - 1] : '';
    if (/^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  } catch {
    // ignore
  }
  return '';
}

function localeFallback() {
  return { countryCode: localeCountryCodeUpper(), city: '', region: '' };
}

function normalizeText(v) {
  const t = v != null ? String(v).trim() : '';
  return t;
}

function normalizeCountryCode(v) {
  const s = normalizeText(v).toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

async function fetchJsonWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** @param {Record<string, unknown>} data ipwho.is payload */
function parseIpWho(data) {
  if (!data || typeof data !== 'object' || data.success === false) return null;
  const countryCode = normalizeCountryCode(data.country_code);
  if (!countryCode) return null;
  const city = normalizeText(data.city);
  let region = normalizeText(data.region);
  if (!region) region = normalizeText(data.regionName);
  return { countryCode, city, region };
}

/** @param {Record<string, unknown>} data ipapi.co payload */
function parseIpApiCo(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.error) return null;
  const countryCode = normalizeCountryCode(data.country_code);
  if (!countryCode) return null;
  const city = normalizeText(data.city);
  let region = normalizeText(data.region);
  if (!region) region = normalizeText(data.region_code);
  return { countryCode, city, region };
}

let cachedPayload = null;
let backgroundGeoPromise = null;

async function resolveIpGeoOnce() {
  const fallback = localeFallback();

  try {
    try {
      const d = await fetchJsonWithTimeout('https://ipwho.is/');
      const p = parseIpWho(d);
      if (p?.countryCode) return p;
    } catch {
      // try next provider
    }

    try {
      const d = await fetchJsonWithTimeout('https://ipapi.co/json/');
      const p = parseIpApiCo(d);
      if (p?.countryCode) return p;
    } catch {
      // fall through
    }
  } catch {
    // ignore
  }

  return fallback;
}

function ensureBackgroundGeoResolve() {
  if (cachedPayload != null) return;
  if (backgroundGeoPromise) return;
  backgroundGeoPromise = resolveIpGeoOnce()
    .then((out) => {
      cachedPayload = out;
    })
    .catch(() => {
      cachedPayload = localeFallback();
    })
    .finally(() => {
      backgroundGeoPromise = null;
    });
}

/**
 * Session-scoped geo: never awaits external IP lookups on the caller path.
 * First call yields locale fallback; after background resolve, returns IP-based row.
 *
 * @returns {Promise<{ countryCode: string; city: string; region: string }>}
 */
export async function getAnalyticsLocationPayload() {
  try {
    if (cachedPayload != null) return cachedPayload;
    ensureBackgroundGeoResolve();
    return localeFallback();
  } catch {
    return localeFallback();
  }
}
