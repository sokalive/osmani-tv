import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { getDeviceIdentity } from './deviceIdentity';
import { getAnalyticsLocationPayload } from './analyticsLocation';
import { readNativeAndroidVersionCode } from './playVpsApiHost';
import { getApiBaseUrl } from './apiBaseUrl';

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

function readTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function readLanguage() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    return '';
  }
}

function readRuntimeVersion() {
  try {
    const Updates = require('expo-updates');
    const rv = Updates?.runtimeVersion;
    if (rv != null && String(rv).trim()) return String(rv).trim();
  } catch {
    /* optional */
  }
  const cfg = Constants.expoConfig?.version ?? Constants.manifest?.version;
  return cfg != null ? String(cfg) : '';
}

/**
 * Full device + install envelope for Admin User Center telemetry.
 * IP is inferred server-side from the request; client sends geo hints only.
 */
export async function buildUserCenterDeviceEnvelope(extra = {}) {
  const identity = await getDeviceIdentity();
  const loc = await getAnalyticsLocationPayload().catch(() => ({
    countryCode: '',
    city: '',
    region: '',
  }));
  const versionCode = readNativeAndroidVersionCode();
  const now = new Date();
  const occurredAt = extra.occurred_at ?? extra.occurredAt ?? now.toISOString();

  return {
    device_id: identity.deviceId,
    device_fingerprint: identity.deviceFingerprint,
    android_id: identity.androidId ?? identity.packageAndroidId ?? identity.deviceId,
    stable_hardware_id: identity.stableHardwareId ?? null,
    install_instance_id: identity.installInstanceId,
    package_name: identity.packageName,
    legacy_package_name: identity.legacyPackageName ?? null,
    android_version: readAndroidVersion(),
    device_model: readAndroidModel(),
    device_brand: readAndroidBrand(),
    manufacturer: readAndroidBrand(),
    build_number: nativeBuildVersion ?? null,
    version_code: Number.isFinite(versionCode) && versionCode > 0 ? versionCode : null,
    app_version: nativeApplicationVersion ?? '',
    runtime_version: readRuntimeVersion(),
    platform: Platform.OS,
    timezone: readTimezone(),
    language: readLanguage(),
    country: loc.countryCode || null,
    country_code: loc.countryCode || null,
    city: loc.city || null,
    region: loc.region || null,
    api_host: getApiBaseUrl(),
    occurred_at: occurredAt,
    date: occurredAt.slice(0, 10),
    time: now.toTimeString().slice(0, 8),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    ...extra,
  };
}
