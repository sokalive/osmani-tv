import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { nativeApplicationVersion } from 'expo-application';
import { BASE_URL } from '../api';
import { getDeviceIdentity } from '../lib/deviceIdentity';

const INSTALL_TRACKED_KEY = 'osmani:install_tracked_v1';
const PING_MS = 30000;
const RETRY_DELAYS_MS = [0, 700, 1800];

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
      if (res.ok) return true;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
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
    if (already === '1') return;
    const { deviceId } = await getDeviceIdentity();
    const ok = await postJson('/api/analytics/install', {
      device_id: deviceId,
      platform: Platform.OS,
      app_version: nativeApplicationVersion ?? 'unknown',
      country: detectCountry(),
      device_model: detectDeviceModel(),
    });
    if (ok) {
      await AsyncStorage.setItem(INSTALL_TRACKED_KEY, '1');
    }
  } catch {
    // Analytics must not break app launch.
  }
}

export async function startLiveSession(channelId, channelName) {
  try {
    const { deviceId } = await getDeviceIdentity();
    await postJson('/api/analytics/session/start', {
      device_id: deviceId,
      channel_id: String(channelId ?? ''),
      channel_name: String(channelName ?? ''),
      country: detectCountry(),
      started_at: new Date().toISOString(),
    });
    return deviceId;
  } catch {
    return '';
  }
}

export async function stopLiveSession(deviceId, channelId) {
  if (!deviceId) return;
  await postJson('/api/analytics/session/end', {
    device_id: deviceId,
    channel_id: String(channelId ?? ''),
    ended_at: new Date().toISOString(),
  });
}

export async function pingLiveSession(deviceId, channelId) {
  if (!deviceId) return;
  await postJson('/api/analytics/session/heartbeat', {
    device_id: deviceId,
    channel_id: String(channelId ?? ''),
    timestamp: new Date().toISOString(),
  });
}

export { PING_MS };
