/**
 * Block gallery/storage permissions merged from dependencies (expo-screen-capture,
 * expo-image, expo-file-system) using manifest merger tools:node="remove".
 *
 * Must use addBlockedPermissions — removePermissions() would delete Expo's own
 * blockedPermissions entries and let library manifests re-add READ_MEDIA_* at Gradle merge.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const { ensureToolsAvailable } = require('@expo/config-plugins/build/android/Manifest');

const BLOCKED_PERMISSIONS = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.REQUEST_INSTALL_PACKAGES',
];

const withStripMediaPermissions = (config) =>
  withAndroidManifest(config, (cfg) => {
    let manifest = ensureToolsAvailable(cfg.modResults);
    AndroidConfig.Permissions.addBlockedPermissions(manifest, BLOCKED_PERMISSIONS);
    cfg.modResults = manifest;
    return cfg;
  });

module.exports = withStripMediaPermissions;
