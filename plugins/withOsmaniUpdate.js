const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin for the local osmani-update native module.
 * Adds REQUEST_INSTALL_PACKAGES only when APK sideload is enabled (not Play Store).
 * Set EXPO_PUBLIC_APK_INSTALLER_ENABLED=0 on production EAS profile to omit the permission.
 */
const withOsmaniUpdate = (config) =>
  withAndroidManifest(config, (cfg) => {
    const enabled = process.env.EXPO_PUBLIC_APK_INSTALLER_ENABLED !== '0';
    if (enabled) {
      AndroidConfig.Permissions.addPermission(
        cfg.modResults,
        'android.permission.REQUEST_INSTALL_PACKAGES',
      );
    }
    return cfg;
  });

module.exports = withOsmaniUpdate;
