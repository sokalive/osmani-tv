import { Platform } from 'react-native';
import { getAndroidId, nativeApplicationVersion } from 'expo-application';
import { getDeviceIdentity } from './deviceIdentity';
import { collectOneSignalPushSnapshot } from './oneSignalPushRegistration';

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

  const pushSnap = await collectOneSignalPushSnapshot().catch(() => null);

  const body = {
    device_id: deviceId,
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

  if (pushSnap && typeof pushSnap === 'object') {
    if (pushSnap.pushSubscriptionId) {
      body.push_subscription_id = pushSnap.pushSubscriptionId;
      body.pushSubscriptionId = pushSnap.pushSubscriptionId;
    }
    if (pushSnap.onesignalId) {
      body.onesignal_id = pushSnap.onesignalId;
      body.onesignalId = pushSnap.onesignalId;
    }
    if (pushSnap.optedIn != null) {
      body.push_opted_in = pushSnap.optedIn === true;
      body.pushOptedIn = pushSnap.optedIn === true;
    }
    if (pushSnap.permission != null) {
      body.push_permission = pushSnap.permission === true;
      body.pushPermission = pushSnap.permission === true;
    }
    if (pushSnap.versionCode != null) {
      body.native_version_code = pushSnap.versionCode;
      body.nativeVersionCode = pushSnap.versionCode;
    }
  }

  return body;
}
