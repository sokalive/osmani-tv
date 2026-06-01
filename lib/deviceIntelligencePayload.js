import { Platform } from 'react-native';
import { getAndroidId, nativeApplicationVersion } from 'expo-application';
import { getDeviceIdentity } from './deviceIdentity';

function readAndroidBrand() {
  try {
    const c = Platform.constants || {};
    return String(c.Brand || c.Manufacturer || '').trim();
  } catch {
    return '';
  }
}

function readAndroidModel() {
  try {
    const c = Platform.constants || {};
    return String(c.Model || '').trim();
  } catch {
    return '';
  }
}

function readAndroidVersion() {
  if (Platform.OS !== 'android') return '';
  const v = Platform.Version;
  return v != null && String(v).trim() ? String(v).trim() : '';
}

/**
 * @param {{ firstSeen?: string | null }} [opts]
 */
export async function buildDeviceIntelligenceRegistrationBody(opts = {}) {
  const { deviceId, deviceFingerprint } = await getDeviceIdentity();
  const nowIso = new Date().toISOString();
  const androidId =
    Platform.OS === 'android' && typeof getAndroidId === 'function'
      ? String(getAndroidId() || '').trim() || deviceId
      : deviceId;

  return {
    device_fingerprint: deviceFingerprint,
    android_id: androidId,
    device_model: readAndroidModel(),
    device_brand: readAndroidBrand(),
    android_version: readAndroidVersion(),
    app_version: nativeApplicationVersion ?? '',
    platform: Platform.OS,
    first_seen: opts.firstSeen ?? null,
    last_seen: nowIso,
  };
}
