/**
 * Expo config plugin for the local osmani-update native module.
 * FileProvider and paths are merged from the module AndroidManifest;
 * no extra host permissions are injected (Play Store compliance).
 */
const withOsmaniUpdate = (config) => config;

module.exports = withOsmaniUpdate;
