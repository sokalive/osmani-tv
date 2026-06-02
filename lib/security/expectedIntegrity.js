import Constants from 'expo-constants';

/**
 * Expected Android package id from Expo config (official Play / EAS build).
 * @returns {string}
 */
export function readExpectedAndroidPackage() {
  try {
    const extra = Constants.expoConfig?.extra ?? {};
    const fromExtra = extra.expectedAndroidPackage ?? extra.expectedPackageName;
    const fromAndroid = Constants.expoConfig?.android?.package;
    const fromEnv = process.env.EXPO_PUBLIC_EXPECTED_ANDROID_PACKAGE;
    const v = fromExtra ?? fromAndroid ?? fromEnv ?? '';
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Release signing cert SHA-256 (hex, lowercase) for resign / tamper detection.
 * @returns {string}
 */
export function readExpectedSigningCertSha256() {
  try {
    const extra = Constants.expoConfig?.extra ?? {};
    const v =
      extra.expectedSigningCertSha256 ??
      process.env.EXPO_PUBLIC_ANDROID_SIGNING_CERT_SHA256 ??
      '';
    return typeof v === 'string' ? v.trim().toLowerCase() : '';
  } catch {
    return '';
  }
}
