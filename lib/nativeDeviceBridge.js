import { Platform } from 'react-native';

/**
 * Safe wrappers around osmani-security native identity helpers.
 * Returns empty string when the native module is unavailable (web / old builds).
 */

async function loadOsmaniSecurity() {
  if (Platform.OS !== 'android') return null;
  try {
    return await import('../modules/osmani-security');
  } catch {
    return null;
  }
}

/** @returns {Promise<string>} */
export async function readPackageAndroidIdNative() {
  const mod = await loadOsmaniSecurity();
  if (!mod?.getPackageAndroidId) return '';
  return String(mod.getPackageAndroidId() ?? '').trim();
}

/** @param {string} legacyPackageName @returns {Promise<string>} */
export async function readLegacyPackageAndroidIdNative(legacyPackageName) {
  const mod = await loadOsmaniSecurity();
  if (!mod?.tryReadLegacyPackageAndroidId) return '';
  return String(mod.tryReadLegacyPackageAndroidId(legacyPackageName) ?? '').trim();
}

/** @returns {Promise<string>} */
export async function readStableHardwareIdNative() {
  const mod = await loadOsmaniSecurity();
  if (!mod?.getStableHardwareId) return '';
  return String(mod.getStableHardwareId() ?? '').trim();
}
