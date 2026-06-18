import { Platform } from 'react-native';
import {
  applicationId,
  getAndroidId,
  getIosIdForVendorAsync,
} from 'expo-application';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readLegacyPackageAndroidIdNative,
  readPackageAndroidIdNative,
  readStableHardwareIdNative,
} from './nativeDeviceBridge';

const INSTALL_ID_KEY = 'osmani:install_uuid';
const ANDROID_ID_CACHE_KEY = 'osmani:android_id_v1';
const LEGACY_DEVICE_ID_KEY = 'osmani:legacy_device_id_v1';
const STABLE_HARDWARE_ID_KEY = 'osmani:stable_hardware_id_v1';

/** Render-era APK applicationId (subscriptions may reference this bundle in fingerprint). */
export const LEGACY_ANDROID_PACKAGE = 'com.osmantv.app';

/**
 * Per app-data install instance (new UUID after uninstall / clear storage).
 * @returns {Promise<string>}
 */
export async function getInstallInstanceId() {
  let id = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (!id) {
    id = await Crypto.randomUUID();
    await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  }
  return id;
}

/**
 * @param {string} deviceId
 * @param {string} bundleId
 * @param {string} installInstanceId
 */
export async function computeDeviceFingerprint(deviceId, bundleId, installInstanceId) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${deviceId}|${bundleId}|${installInstanceId}`,
  );
}

async function readCachedValue(key) {
  try {
    const v = await AsyncStorage.getItem(key);
    return typeof v === 'string' && v.trim() ? v.trim() : '';
  } catch {
    return '';
  }
}

async function writeCachedValue(key, value) {
  if (!value) return;
  try {
    await AsyncStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

/**
 * @returns {Promise<{
 *   deviceId: string;
 *   deviceFingerprint: string;
 *   installInstanceId: string;
 *   packageName: string;
 *   packageAndroidId: string;
 *   legacyPackageAndroidId: string | null;
 *   stableHardwareId: string | null;
 *   androidId: string | null;
 *   legacyDeviceFingerprint: string | null;
 *   legacyPackageName: string;
 *   displayedAccountId: string;
 *   subscriptionDeviceId: string;
 *   identityCandidates: { role: string; deviceId: string }[];
 * }>}
 */
export async function getDeviceIdentity() {
  const installInstanceId = await getInstallInstanceId();
  const packageName = applicationId ?? 'osmani-tv';

  let packageAndroidId = '';
  if (Platform.OS === 'android') {
    packageAndroidId =
      (await readPackageAndroidIdNative()) ||
      String(getAndroidId() || '').trim() ||
      (await readCachedValue(ANDROID_ID_CACHE_KEY));
  } else if (Platform.OS === 'ios') {
    try {
      packageAndroidId = String((await getIosIdForVendorAsync()) || '').trim();
    } catch {
      packageAndroidId = '';
    }
  }

  if (packageAndroidId) void writeCachedValue(ANDROID_ID_CACHE_KEY, packageAndroidId);

  let legacyPackageAndroidId = await readCachedValue(LEGACY_DEVICE_ID_KEY);
  if (Platform.OS === 'android' && packageName !== LEGACY_ANDROID_PACKAGE) {
    const liveLegacy = await readLegacyPackageAndroidIdNative(LEGACY_ANDROID_PACKAGE);
    if (liveLegacy) {
      legacyPackageAndroidId = liveLegacy;
      void writeCachedValue(LEGACY_DEVICE_ID_KEY, liveLegacy);
    }
  }

  let stableHardwareId = await readCachedValue(STABLE_HARDWARE_ID_KEY);
  if (Platform.OS === 'android') {
    const liveStable = await readStableHardwareIdNative();
    if (liveStable) {
      stableHardwareId = liveStable;
      void writeCachedValue(STABLE_HARDWARE_ID_KEY, liveStable);
    }
  }

  const subscriptionDeviceId =
    legacyPackageAndroidId || stableHardwareId || packageAndroidId || installInstanceId;

  const deviceFingerprint = await computeDeviceFingerprint(
    subscriptionDeviceId,
    packageName,
    installInstanceId,
  );

  let legacyDeviceFingerprint = null;
  if (packageName !== LEGACY_ANDROID_PACKAGE) {
    const legacyIdForFp = legacyPackageAndroidId || packageAndroidId || subscriptionDeviceId;
    legacyDeviceFingerprint = await computeDeviceFingerprint(
      legacyIdForFp,
      LEGACY_ANDROID_PACKAGE,
      installInstanceId,
    );
  }

  const identityCandidates = [];
  const pushCandidate = (role, deviceId) => {
    const id = String(deviceId || '').trim();
    if (!id) return;
    if (identityCandidates.some((c) => c.deviceId === id)) return;
    identityCandidates.push({ role, deviceId: id });
  };

  pushCandidate('legacy_package_android_id', legacyPackageAndroidId);
  pushCandidate('stable_hardware_id', stableHardwareId);
  pushCandidate('package_android_id', packageAndroidId);
  pushCandidate('install_instance_id', installInstanceId);

  const identity = {
    deviceId: subscriptionDeviceId,
    deviceFingerprint,
    installInstanceId,
    packageName,
    packageAndroidId: packageAndroidId || null,
    legacyPackageAndroidId: legacyPackageAndroidId || null,
    stableHardwareId: stableHardwareId || null,
    androidId: packageAndroidId || null,
    legacyDeviceFingerprint,
    legacyPackageName: LEGACY_ANDROID_PACKAGE,
    displayedAccountId: packageAndroidId || subscriptionDeviceId,
    subscriptionDeviceId,
    identityCandidates,
  };

  console.log(
    '[DEVICE_IDENTITY]',
    JSON.stringify({
      displayedAccountId: identity.displayedAccountId?.slice(0, 8) + '…',
      subscriptionDeviceId: identity.subscriptionDeviceId?.slice(0, 8) + '…',
      legacyPackageAndroidId: identity.legacyPackageAndroidId?.slice(0, 8) + '…' || null,
      stableHardwareId: identity.stableHardwareId?.slice(0, 12) + '…' || null,
      packageName,
      installInstanceId: installInstanceId.slice(0, 8) + '…',
      fingerprintPreview: deviceFingerprint.slice(0, 12) + '…',
      candidateCount: identityCandidates.length,
      candidates: identityCandidates.map((c) => ({
        role: c.role,
        id: c.deviceId.slice(0, 8) + '…',
      })),
    }),
  );

  return identity;
}
