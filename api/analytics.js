import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { nativeApplicationVersion } from 'expo-application';
import { BASE_URL } from '../api';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { getAnalyticsLocationPayload } from '../lib/analyticsLocation';

const INSTALL_TRACKED_KEY = 'osmani:install_tracked_v1';
const PING_MS = 30000;
/** Heartbeat for the app-level presence layer (decoupled from channel session). */
const PRESENCE_PING_MS = 25000;
const RETRY_DELAYS_MS = [0, 700, 1800];
const ANALYTICS_DEBUG = true;

let cachedAppSessionId = '';

async function getOrCreateAppSessionId() {
  if (cachedAppSessionId) return cachedAppSessionId;
  try {
    cachedAppSessionId = await Crypto.randomUUID();
  } catch {
    cachedAppSessionId = `s-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
  return cachedAppSessionId;
}

function detectCountry() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    const parts = String(locale).replace('_', '-').split('-');
    const region = parts.length >= 2 ? parts[parts.length - 1] : '';
    if (/^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  } catch {
    // ignore locale parsing failure
  }
  return null;
}

/** Live sessions + presence payloads: camelCase trio + legacy `country` alias. */
async function resolveLocationEnvelope() {
  try {
    const loc = await getAnalyticsLocationPayload();
    const code =
      typeof loc.countryCode === 'string' && loc.countryCode.trim()
        ? loc.countryCode.trim()
        : '';
    const fromLocale = detectCountry();
    const countryCode = code || fromLocale || '';
    return {
      countryCode,
      city: typeof loc.city === 'string' ? loc.city : '',
      region: typeof loc.region === 'string' ? loc.region : '',
      /** @deprecated Prefer `countryCode`; kept for APIs that map `country` only. */
      country: countryCode || null,
    };
  } catch {
    const c = detectCountry() || '';
    return { countryCode: c, city: '', region: '', country: c || null };
  }
}

function detectDeviceModel() {
  try {
    const m = Platform.constants?.Model;
    if (typeof m === 'string' && m.trim()) return m.trim();
  } catch {
    // ignore platform constants parsing failure
  }
  return null;
}

async function wait(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(path, body, { retries = RETRY_DELAYS_MS } = {}) {
  const url = `${BASE_URL}${path}`;
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] resolved BASE_URL:', BASE_URL);
    console.log('[analytics] request URL:', url);
    console.log('[analytics] payload:', JSON.stringify(body));
  }
  let lastError = null;
  for (let i = 0; i < retries.length; i++) {
    const delay = retries[i];
    await wait(delay);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseText = await res.text();
      if (ANALYTICS_DEBUG) {
        console.log('[analytics] response status:', res.status);
        console.log('[analytics] response body:', responseText);
      }
      if (res.ok) return true;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (ANALYTICS_DEBUG) {
        console.log('[analytics] network error:', String(err));
      }
    }
  }
  try {
    console.log('[analytics] request failed:', path, String(lastError ?? 'unknown'));
  } catch {
    // logging must never crash app
  }
  return false;
}

export async function trackInstallOnce() {
  try {
    const already = await AsyncStorage.getItem(INSTALL_TRACKED_KEY);
    if (ANALYTICS_DEBUG) {
      console.log('[analytics] install dedupe flag:', already);
    }
    if (already === '1') {
      if (ANALYTICS_DEBUG) {
        console.log('[analytics] install skipped: already tracked');
      }
      return;
    }
    const { deviceId } = await getDeviceIdentity();
    if (ANALYTICS_DEBUG) {
      console.log('[analytics] install device_id:', deviceId);
    }
    const ok = await postJson('/api/analytics/install', {
      device_id: deviceId,
      platform: Platform.OS,
      app_version: nativeApplicationVersion ?? 'unknown',
      country: detectCountry(),
      device_model: detectDeviceModel(),
    });
    if (ok) {
      await AsyncStorage.setItem(INSTALL_TRACKED_KEY, '1');
      if (ANALYTICS_DEBUG) {
        console.log('[analytics] install marked as tracked');
      }
    } else if (ANALYTICS_DEBUG) {
      console.log('[analytics] install not marked tracked due to failed request');
    }
  } catch {
    // Analytics must not break app launch.
  }
}

export async function startLiveSession(channelId, channelName) {
  try {
    const { deviceId } = await getDeviceIdentity();
    const loc = await resolveLocationEnvelope();
    if (ANALYTICS_DEBUG) {
      console.log('[analytics] session start values:', {
        device_id: deviceId,
        channel_id: String(channelId ?? ''),
        channel_name: String(channelName ?? ''),
        countryCode: loc.countryCode,
        city: loc.city,
        region: loc.region,
      });
    }
    await postJson('/api/analytics/session/start', {
      device_id: deviceId,
      channel_id: String(channelId ?? ''),
      channel_name: String(channelName ?? ''),
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
      country: loc.country,
      started_at: new Date().toISOString(),
    });
    return deviceId;
  } catch {
    return '';
  }
}

export async function stopLiveSession(deviceId, channelId) {
  if (!deviceId) return;
  const loc = await resolveLocationEnvelope();
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] session end values:', {
      device_id: deviceId,
      channel_id: String(channelId ?? ''),
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
    });
  }
  await postJson('/api/analytics/session/end', {
    device_id: deviceId,
    channel_id: String(channelId ?? ''),
    countryCode: loc.countryCode,
    city: loc.city,
    region: loc.region,
    country: loc.country,
    ended_at: new Date().toISOString(),
  });
}

export async function pingLiveSession(deviceId, channelId) {
  if (!deviceId) return;
  const loc = await resolveLocationEnvelope();
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] heartbeat values:', {
      device_id: deviceId,
      channel_id: String(channelId ?? ''),
      every_ms: PING_MS,
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
    });
  }
  await postJson('/api/analytics/session/heartbeat', {
    device_id: deviceId,
    channel_id: String(channelId ?? ''),
    countryCode: loc.countryCode,
    city: loc.city,
    region: loc.region,
    country: loc.country,
    timestamp: new Date().toISOString(),
  });
}

/**
 * App-level presence (Live User Locations). Fires the moment the app
 * opens — independent of channel playback. Channel context is attached
 * later via `pingAppPresence`/`stopAppPresence` payloads.
 *
 * @returns {Promise<{ sessionId: string; deviceId: string; ok: boolean }>}
 */
export async function startAppPresence() {
  try {
    const sessionId = await getOrCreateAppSessionId();
    const { deviceId } = await getDeviceIdentity();
    const loc = await resolveLocationEnvelope();
    if (ANALYTICS_DEBUG) {
      console.log('[analytics] presence start:', {
        session_id: sessionId,
        device_id: deviceId,
        countryCode: loc.countryCode,
        city: loc.city,
        region: loc.region,
      });
    }
    const ok = await postJson('/api/analytics/presence/start', {
      session_id: sessionId,
      device_id: deviceId,
      platform: Platform.OS,
      app_version: nativeApplicationVersion ?? 'unknown',
      device_model: detectDeviceModel(),
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
      country: loc.country,
      started_at: new Date().toISOString(),
    });
    return { sessionId, deviceId, ok };
  } catch {
    return { sessionId: '', deviceId: '', ok: false };
  }
}

/**
 * @param {{ sessionId: string; deviceId?: string; channelId?: string|null;
 *           channelName?: string|null }} args
 */
export async function pingAppPresence(args) {
  const sessionId = args?.sessionId;
  if (!sessionId) return false;
  const loc = await resolveLocationEnvelope();
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] presence heartbeat:', {
      session_id: sessionId,
      channel_id: args?.channelId ?? null,
      every_ms: PRESENCE_PING_MS,
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
    });
  }
  return postJson(
    '/api/analytics/presence/heartbeat',
    {
      session_id: sessionId,
      device_id: args?.deviceId ?? null,
      channel_id: args?.channelId != null && args.channelId !== '' ? String(args.channelId) : null,
      channel_name:
        args?.channelName != null && args.channelName !== '' ? String(args.channelName) : null,
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
      country: loc.country,
      timestamp: new Date().toISOString(),
    },
    { retries: [0] },
  );
}

/**
 * @param {{ sessionId: string; deviceId?: string }} args
 */
export async function stopAppPresence(args) {
  const sessionId = args?.sessionId;
  if (!sessionId) return false;
  const loc = await resolveLocationEnvelope();
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] presence stop:', {
      session_id: sessionId,
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
    });
  }
  return postJson(
    '/api/analytics/presence/stop',
    {
      session_id: sessionId,
      device_id: args?.deviceId ?? null,
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
      country: loc.country,
      ended_at: new Date().toISOString(),
    },
    { retries: [0, 600] },
  );
}

export { PING_MS, PRESENCE_PING_MS };
