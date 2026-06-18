import { Platform } from 'react-native';
import {
  applicationId,
  getAndroidId,
  getIosIdForVendorAsync,
} from 'expo-application';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const INSTALL_ID_KEY = 'osmani:install_uuid';
/** Stable hardware id cache — survives fingerprint changes across package migrations. */
const ANDROID_ID_CACHE_KEY = 'osmani:android_id_v1';

/** Render-era APK applicationId (subscriptions may reference this bundle in fingerprint). */
export const LEGACY_ANDROID_PACKAGE = 'com.osmantv.app';

/**
 * Per app-data install instance (new UUID after uninstall / clear storage).
 * Backend pairs with stable `device_id` for reinstall-aware Total App Installs.
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

async function readCachedAndroidId() {
  try {
    const v = await AsyncStorage.getItem(ANDROID_ID_CACHE_KEY);
    return typeof v === 'string' && v.trim() ? v.trim() : '';
  } catch {
    return '';
  }
}

async function writeCachedAndroidId(androidId) {
  if (!androidId) return;
  try {
    await AsyncStorage.setItem(ANDROID_ID_CACHE_KEY, androidId);
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
 *   androidId: string | null;
 *   legacyDeviceFingerprint: string | null;
 *   legacyPackageName: string;
 * }>}
 */
export async function getDeviceIdentity() {
  const installInstanceId = await getInstallInstanceId();
  let androidId = await readCachedAndroidId();
  let hardwareId = '';

  try {
    if (Platform.OS === 'android') {
      const aid = getAndroidId();
      if (typeof aid === 'string' && aid.length > 0) {
        hardwareId = aid;
        androidId = aid;
        void writeCachedAndroidId(aid);
      }
    } else if (Platform.OS === 'ios') {
      const idfv = await getIosIdForVendorAsync();
      if (typeof idfv === 'string' && idfv.length > 0) {
        hardwareId = idfv;
        androidId = idfv;
        void writeCachedAndroidId(idfv);
      }
    }
  } catch {
    hardwareId = '';
  }

  if (!hardwareId && androidId) hardwareId = androidId;

  const deviceId = hardwareId || installInstanceId;
  const packageName = applicationId ?? 'osmani-tv';
  const deviceFingerprint = await computeDeviceFingerprint(
    deviceId,
    packageName,
    installInstanceId,
  );

  let legacyDeviceFingerprint = null;
  if (packageName !== LEGACY_ANDROID_PACKAGE) {
    legacyDeviceFingerprint = await computeDeviceFingerprint(
      deviceId,
      LEGACY_ANDROID_PACKAGE,
      installInstanceId,
    );
  }

  const identity = {
    deviceId,
    deviceFingerprint,
    installInstanceId,
    packageName,
    androidId: hardwareId || null,
    legacyDeviceFingerprint,
    legacyPackageName: LEGACY_ANDROID_PACKAGE,
  };

  console.log('[DEVICE_IDENTITY]', JSON.stringify({
    deviceId: deviceId.slice(0, 8) + (deviceId.length > 8 ? '…' : ''),
    packageName,
    installInstanceId: installInstanceId.slice(0, 8) + '…',
    fingerprintPreview: deviceFingerprint.slice(0, 12) + '…',
    legacyFingerprintPreview: legacyDeviceFingerprint
      ? legacyDeviceFingerprint.slice(0, 12) + '…'
      : null,
    androidIdBound: Boolean(hardwareId),
  }));

  return identity;
}
