import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api';
import { getDeviceIdentity } from '../lib/deviceIdentity';

const INSTALL_TRACKED_KEY = 'osmani:install_tracked_v1';
const PING_MS = 30000;

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

async function postJson(path, body) {
  try {
    await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Analytics must not break playback/navigation.
  }
}

export async function trackInstallOnce() {
  const already = await AsyncStorage.getItem(INSTALL_TRACKED_KEY);
  if (already === '1') return;
  const { deviceId } = await getDeviceIdentity();
  await postJson('/api/app/install', {
    device_id: deviceId,
    country: detectCountry(),
  });
  await AsyncStorage.setItem(INSTALL_TRACKED_KEY, '1');
}

export async function startLiveSession(channelId) {
  const { deviceId } = await getDeviceIdentity();
  await postJson('/api/live-session/start', {
    device_id: deviceId,
    channel_id: String(channelId ?? ''),
    country: detectCountry(),
  });
  return deviceId;
}

export async function stopLiveSession(deviceId) {
  if (!deviceId) return;
  await postJson('/api/live-session/stop', {
    device_id: deviceId,
    country: detectCountry(),
  });
}

export async function pingLiveSession(deviceId) {
  if (!deviceId) return;
  await postJson('/api/live-session/ping', {
    device_id: deviceId,
    country: detectCountry(),
  });
}

export { PING_MS };
