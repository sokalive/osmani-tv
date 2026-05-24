const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin for the local osmani-update native module.
 * Merges FileProvider from the library manifest and ensures sideload APK
 * installs can prompt on Android 8+ (REQUEST_INSTALL_PACKAGES).
 */
const withOsmaniUpdate = (config) =>
  withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.addPermission(
      cfg.modResults,
      'android.permission.REQUEST_INSTALL_PACKAGES',
    );
    return cfg;
  });

module.exports = withOsmaniUpdate;
