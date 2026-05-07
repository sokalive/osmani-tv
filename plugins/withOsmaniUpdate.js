/**
 * Expo config plugin for the local osmani-update native module.
 *
 * Why this exists:
 *   The native module's own AndroidManifest.xml (in
 *   `modules/osmani-update/android/src/main/AndroidManifest.xml`)
 *   already declares both `REQUEST_INSTALL_PACKAGES` and the
 *   FileProvider. AGP's manifest merger merges those into the final
 *   APK manifest at build time, which is sufficient.
 *
 *   However, having `REQUEST_INSTALL_PACKAGES` only in a library
 *   manifest historically interacts poorly with some AGP versions,
 *   Play Console permission auditing, and ProGuard / R8 manifest
 *   filtering. We therefore *also* declare the permission on the
 *   host app manifest so it is:
 *     - visible in `android/app/src/main/AndroidManifest.xml` after
 *       every `expo prebuild` (auditable),
 *     - resilient to AGP version changes,
 *     - guaranteed to survive Play Console review.
 *
 *   The FileProvider is intentionally NOT redeclared here, because
 *   declaring it twice with the same authority would trigger an
 *   AGP "duplicate provider authority" merge error.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const PERMISSIONS = ['android.permission.REQUEST_INSTALL_PACKAGES'];

const withOsmaniUpdate = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    for (const perm of PERMISSIONS) {
      if (!AndroidConfig.Permissions.ensurePermission(manifest, perm)) {
        AndroidConfig.Permissions.addPermission(manifest, perm);
      }
    }
    return cfg;
  });
};

module.exports = withOsmaniUpdate;
