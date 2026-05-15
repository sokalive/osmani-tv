import { Platform } from 'react-native';
import {
  applicationId,
  getAndroidId,
  getIosIdForVendorAsync,
} from 'expo-application';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const INSTALL_ID_KEY = 'osmani:install_uuid';

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
 * @returns {Promise<{ deviceId: string; deviceFingerprint: string; installInstanceId: string }>}
 */
export async function getDeviceIdentity() {
  const installInstanceId = await getInstallInstanceId();
  let deviceId = '';

  try {
    if (Platform.OS === 'android') {
      const aid = getAndroidId();
      if (typeof aid === 'string' && aid.length > 0) deviceId = aid;
    } else if (Platform.OS === 'ios') {
      const idfv = await getIosIdForVendorAsync();
      if (typeof idfv === 'string' && idfv.length > 0) deviceId = idfv;
    }
  } catch {
    deviceId = '';
  }

  if (!deviceId) deviceId = installInstanceId;

  const bundle = applicationId ?? 'osmani-tv';
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${deviceId}|${bundle}|${installInstanceId}`,
  );

  return { deviceId, deviceFingerprint: fingerprint, installInstanceId };
}
