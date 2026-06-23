import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { nativeApplicationVersion } from 'expo-application';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { getAnalyticsLocationPayload } from '../lib/analyticsLocation';
import { readNativeAndroidVersionCode } from '../lib/playVpsApiHost';

const INSTALL_TRACKED_KEY = 'osmani:install_tracked_v1';
const PING_MS = 45000;
/** Heartbeat for the app-level presence layer (decoupled from channel session). */
const PRESENCE_PING_MS = 45000;
const RETRY_DELAYS_MS = [0, 700, 1800];
/** Channel watch heartbeats — keep retries so dashboard counts stay stable. */
const SESSION_HEARTBEAT_RETRIES_MS = [0, 800, 2000, 5000];
const ANALYTICS_DEBUG = __DEV__;

async function createWatchSessionId() {
  try {
    return await Crypto.randomUUID();
  } catch {
    return `w-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/**
 * @param {string} channelId
 * @param {string} channelName
 * @param {string} watchSessionId
 */
async function buildChannelWatchPayload(channelId, channelName, watchSessionId) {
  const { deviceId, installInstanceId } = await getDeviceIdentity();
  const loc = await resolveLocationEnvelope();
  const versionCode = readNativeAndroidVersionCode();
  return {
    device_id: deviceId,
    session_id: watchSessionId,
    watch_session_id: watchSessionId,
    install_instance_id: installInstanceId,
    channel_id: String(channelId ?? ''),
    channel_name: String(channelName ?? ''),
    platform: Platform.OS,
    app_version: nativeApplicationVersion ?? 'unknown',
    version_code: Number.isFinite(versionCode) && versionCode > 0 ? versionCode : undefined,
    api_host: getApiBaseUrl(),
    countryCode: loc.countryCode,
    city: loc.city,
    region: loc.region,
    country: loc.country,
  };
}

/**
 * @typedef {{ deviceId: string; watchSessionId: string; installInstanceId: string; channelName: string }} LiveSessionHandle
 */

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
  const base = getApiBaseUrl().replace(/\/+$/, '');
  const url = `${base}${path}`;
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] resolved API base:', base);
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
    const { deviceId, installInstanceId } = await getDeviceIdentity();
    const already = await AsyncStorage.getItem(INSTALL_TRACKED_KEY);
    if (ANALYTICS_DEBUG) {
      console.log('[analytics] install dedupe flag:', already, 'current instance:', installInstanceId);
    }
    // Dedupe per install *instance* (osmani:install_uuid), not per device.
    // Legacy value "1" never matches a UUID → allows POST after reinstall when backup
    // restores osmani:install_tracked_v1 but app data was otherwise reset.
    if (already && already === installInstanceId) {
      if (ANALYTICS_DEBUG) {
        console.log('[analytics] install skipped: instance already tracked');
      }
      return;
    }
    if (ANALYTICS_DEBUG) {
      console.log('[analytics] install device_id:', deviceId, 'install_instance_id:', installInstanceId);
    }
    const ok = await postJson('/api/analytics/install', {
      device_id: deviceId,
      install_instance_id: installInstanceId,
      platform: Platform.OS,
      app_version: nativeApplicationVersion ?? 'unknown',
      country: detectCountry(),
      device_model: detectDeviceModel(),
    });
    if (ok) {
      await AsyncStorage.setItem(INSTALL_TRACKED_KEY, installInstanceId);
      if (ANALYTICS_DEBUG) {
        console.log('[analytics] install marked as tracked for instance:', installInstanceId);
      }
    } else if (ANALYTICS_DEBUG) {
      console.log('[analytics] install not marked tracked due to failed request');
    }
  } catch {
    // Analytics must not break app launch.
  }
}

/**
 * Start a channel watch session (Most Watched Channels).
 * @returns {Promise<LiveSessionHandle>}
 */
export async function startLiveSession(channelId, channelName) {
  const empty = { deviceId: '', watchSessionId: '', installInstanceId: '', channelName: '' };
  try {
    const watchSessionId = await createWatchSessionId();
    const payload = await buildChannelWatchPayload(channelId, channelName, watchSessionId);
    if (ANALYTICS_DEBUG) {
      console.log('[analytics] session start values:', {
        device_id: payload.device_id,
        session_id: watchSessionId,
        install_instance_id: payload.install_instance_id,
        channel_id: payload.channel_id,
        channel_name: payload.channel_name,
        version_code: payload.version_code,
        api_host: payload.api_host,
      });
    }
    await postJson(
      '/api/analytics/session/start',
      {
        ...payload,
        started_at: new Date().toISOString(),
      },
      { retries: SESSION_HEARTBEAT_RETRIES_MS },
    );
    await pingLiveSession(payload.device_id, channelId, {
      watchSessionId,
      channelName: payload.channel_name,
      installInstanceId: payload.install_instance_id,
    });
    return {
      deviceId: payload.device_id,
      watchSessionId,
      installInstanceId: payload.install_instance_id,
      channelName: payload.channel_name,
    };
  } catch {
    return empty;
  }
}

/**
 * @param {string} deviceId
 * @param {string} channelId
 * @param {{ watchSessionId?: string; channelName?: string; installInstanceId?: string }} [meta]
 */
export async function stopLiveSession(deviceId, channelId, meta = {}) {
  if (!deviceId) return;
  const loc = await resolveLocationEnvelope();
  const versionCode = readNativeAndroidVersionCode();
  const watchSessionId = meta.watchSessionId ?? '';
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] session end values:', {
      device_id: deviceId,
      session_id: watchSessionId,
      channel_id: String(channelId ?? ''),
      countryCode: loc.countryCode,
    });
  }
  await postJson(
    '/api/analytics/session/end',
    {
      device_id: deviceId,
      session_id: watchSessionId || undefined,
      watch_session_id: watchSessionId || undefined,
      install_instance_id: meta.installInstanceId ?? undefined,
      channel_id: String(channelId ?? ''),
      channel_name: meta.channelName != null ? String(meta.channelName) : undefined,
      app_version: nativeApplicationVersion ?? 'unknown',
      version_code: Number.isFinite(versionCode) && versionCode > 0 ? versionCode : undefined,
      api_host: getApiBaseUrl(),
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
      country: loc.country,
      ended_at: new Date().toISOString(),
    },
    { retries: SESSION_HEARTBEAT_RETRIES_MS },
  );
}

/**
 * @param {string} deviceId
 * @param {string} channelId
 * @param {{ watchSessionId?: string; channelName?: string; installInstanceId?: string }} [meta]
 */
export async function pingLiveSession(deviceId, channelId, meta = {}) {
  if (!deviceId) return;
  const loc = await resolveLocationEnvelope();
  const versionCode = readNativeAndroidVersionCode();
  const watchSessionId = meta.watchSessionId ?? '';
  if (ANALYTICS_DEBUG) {
    console.log('[analytics] heartbeat values:', {
      device_id: deviceId,
      session_id: watchSessionId,
      channel_id: String(channelId ?? ''),
      every_ms: PING_MS,
      countryCode: loc.countryCode,
    });
  }
  await postJson(
    '/api/analytics/session/heartbeat',
    {
      device_id: deviceId,
      session_id: watchSessionId || undefined,
      watch_session_id: watchSessionId || undefined,
      install_instance_id: meta.installInstanceId ?? undefined,
      channel_id: String(channelId ?? ''),
      channel_name: meta.channelName != null ? String(meta.channelName) : undefined,
      app_version: nativeApplicationVersion ?? 'unknown',
      version_code: Number.isFinite(versionCode) && versionCode > 0 ? versionCode : undefined,
      api_host: getApiBaseUrl(),
      countryCode: loc.countryCode,
      city: loc.city,
      region: loc.region,
      country: loc.country,
      timestamp: new Date().toISOString(),
    },
    { retries: SESSION_HEARTBEAT_RETRIES_MS },
  );
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
