import { Platform } from 'react-native';
import {
  applicationId,
  getAndroidId,
  getIosIdForVendorAsync,
} from 'expo-application';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const INSTALL_ID_KEY = 'osmani:install_uuid';

async function getOrCreateInstallId() {
  let id = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (!id) {
    id = await Crypto.randomUUID();
    await AsyncStorage.setItem(INSTALL_ID_KEY, id);
  }
  return id;
}

/**
 * @returns {Promise<{ deviceId: string; deviceFingerprint: string }>}
 */
export async function getDeviceIdentity() {
  const installId = await getOrCreateInstallId();
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

  if (!deviceId) deviceId = installId;

  const bundle = applicationId ?? 'osmani-tv';
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${deviceId}|${bundle}|${installId}`,
  );

  return { deviceId, deviceFingerprint: fingerprint };
}
