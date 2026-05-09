import * as Location from 'expo-location';

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

function normalizeGeoText(v) {
  const t = v != null ? String(v).trim() : '';
  return t;
}

function reverseGeocodeWithTimeout(latitude, longitude, ms = 10000) {
  return Promise.race([
    Location.reverseGeocodeAsync({ latitude, longitude }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('reverseGeocode timeout')), ms);
    }),
  ]);
}

let cachedPayload = null;
let inflight = null;

/**
 * Resolves once per app session: ISO country + city + region for analytics.
 * Uses device geocoder when permitted; otherwise locale country only.
 *
 * @returns {Promise<{ countryCode: string; city: string; region: string }>}
 */
export async function getAnalyticsLocationPayload() {
  if (cachedPayload) return cachedPayload;
  if (inflight) return inflight;

  inflight = (async () => {
    const fb = localeCountryCodeUpper();
    const fallback = { countryCode: fb, city: '', region: '' };

    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== Location.PermissionStatus.GRANTED) {
        cachedPayload = fallback;
        return cachedPayload;
      }

      const staleMs = 12 * 60 * 1000;
      let pos = await Location.getLastKnownPositionAsync({ maxAge: staleMs });
      if (!pos) {
        pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      const geos = await reverseGeocodeWithTimeout(pos.coords.latitude, pos.coords.longitude);
      const geo = Array.isArray(geos) && geos.length > 0 ? geos[0] : null;
      if (!geo) {
        cachedPayload = fallback;
        return cachedPayload;
      }

      const iso = normalizeGeoText(geo.isoCountryCode).toUpperCase();
      const countryCode = /^[A-Z]{2}$/.test(iso) ? iso : fb;

      const city = normalizeGeoText(geo.city || geo.district || geo.name);
      let region = normalizeGeoText(geo.region);
      if (!region) region = normalizeGeoText(geo.subregion);

      cachedPayload = {
        countryCode: countryCode || '',
        city,
        region,
      };
      return cachedPayload;
    } catch {
      cachedPayload = fallback;
      return cachedPayload;
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
