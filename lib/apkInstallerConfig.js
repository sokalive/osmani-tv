/**
 * In-app APK sideload installer (osmani-update). Disabled for Play Store builds via
 * EXPO_PUBLIC_APK_INSTALLER_ENABLED=0 in eas.json production profile.
 * Re-enable later with Expo OTA or a new native build (set env to 1 or remove it).
 */

/**
 * @returns {boolean}
 */
export function isApkInstallerEnabled() {
  const v = String(process.env.EXPO_PUBLIC_APK_INSTALLER_ENABLED ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}
