/**
 * Ensures photo/video/storage permissions are removed after manifest merge
 * (complements expo.android.blockedPermissions in app.config.js).
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const STRIP_PERMISSIONS = [
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
    let manifest = cfg.modResults;
    AndroidConfig.Permissions.removePermissions(manifest, STRIP_PERMISSIONS);
    cfg.modResults = manifest;
    return cfg;
  });

module.exports = withStripMediaPermissions;
