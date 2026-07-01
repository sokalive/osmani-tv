import { Platform } from 'react-native';
import { getAndroidId, nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { getDeviceIdentity } from './deviceIdentity';
import { collectOneSignalPushSnapshot } from './oneSignalPushRegistration';
import { readNativeAndroidVersionCode } from './playVpsApiHost';

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
  const identity = await getDeviceIdentity();
  const { deviceId, deviceFingerprint, installInstanceId, stableHardwareId } = identity;
  const nowIso = new Date().toISOString();
  const androidId =
    Platform.OS === 'android' && typeof getAndroidId === 'function'
      ? String(getAndroidId() || '').trim() || deviceId
      : deviceId;

  const pushSnap = await collectOneSignalPushSnapshot().catch(() => null);
  const versionCode = readNativeAndroidVersionCode();
  let timezone = '';
  let language = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    language = Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    /* ignore */
  }

  const body = {
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
    android_id: androidId,
    stable_hardware_id: stableHardwareId ?? null,
    install_instance_id: installInstanceId,
    device_model: readAndroidModel(),
    device_brand: readAndroidBrand(),
    manufacturer: readAndroidBrand(),
    android_version: readAndroidVersion(),
    build_number: nativeBuildVersion ?? null,
    version_code: Number.isFinite(versionCode) && versionCode > 0 ? versionCode : null,
    app_version: nativeApplicationVersion ?? '',
    platform: Platform.OS,
    timezone,
    language,
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
