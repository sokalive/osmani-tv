/**
 * IP-only geolocation for analytics/presence payloads (no GPS, no prompts).
 * Uses outbound HTTPS lookups; the service infers geo from the client IP.
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
let inflightPromise = null;

async function resolveIpGeoOnce() {
  const fallback = { countryCode: localeCountryCodeUpper(), city: '', region: '' };

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

/**
 * Resolves once per app session from IP-based services (no device location permission).
 *
 * @returns {Promise<{ countryCode: string; city: string; region: string }>}
 */
export async function getAnalyticsLocationPayload() {
  if (cachedPayload) return cachedPayload;

  if (!inflightPromise) {
    inflightPromise = resolveIpGeoOnce()
      .then((out) => {
        cachedPayload = out;
        return out;
      })
      .finally(() => {
        inflightPromise = null;
      });
  }

  return inflightPromise;
}
