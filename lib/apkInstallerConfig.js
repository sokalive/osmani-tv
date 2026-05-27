/**
 * APK update client flags (osmani-update).
 *
 * - Update checks + popup: always on Android (restored via Expo OTA on Play v1.7.0).
 * - Sideload install: remote-configurable; Play Store v17 builds lack manifest permission
 *   but still show update UI and can open Play Store links.
 */

/** @type {boolean | null} */
let remoteSideloadEnabled = null;

function coerceBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(t)) return false;
  }
  return Boolean(v);
}

function pickDefined(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function collectCandidates(payload) {
  const candidates = [];
  const push = (x) => {
    if (x && typeof x === 'object' && !candidates.includes(x)) candidates.push(x);
  };
  push(payload);
  if (payload && typeof payload === 'object') {
    push(payload.payload);
    push(payload.data);
    push(payload.settings);
    push(payload.app_settings);
    push(payload.config);
  }
  return candidates;
}

/**
 * @param {unknown} payload
 * @returns {boolean | null} applied value, or null if no flag in payload
 */
export function applyRemoteApkInstallerConfig(payload) {
  for (const o of collectCandidates(payload)) {
    const raw = pickDefined(o, [
      'apk_installer_enabled',
      'enable_apk_installer',
      'apkInstallerEnabled',
      'enableApkInstaller',
      'apk_sideload_enabled',
      'enable_apk_sideload',
    ]);
    if (raw !== undefined) {
      remoteSideloadEnabled = coerceBool(raw);
      return remoteSideloadEnabled;
    }
  }
  return null;
}

/** Build-time Play freeze (v1.7.0 Play AAB only). OTA bundles must not set this env. */
function isBuildTimePlayStoreFreeze() {
  const v = String(process.env.EXPO_PUBLIC_APK_INSTALLER_ENABLED ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

/**
 * Update-check + UpdateOverlay (v16→v17 prompts, SOFT/FORCE/PLAY_STORE).
 * @returns {boolean}
 */
export function isApkUpdateCheckEnabled() {
  return true;
}

/**
 * Direct APK download + package installer intent.
 * @returns {boolean}
 */
export function isApkSideloadInstallEnabled() {
  if (remoteSideloadEnabled === false) return false;
  if (remoteSideloadEnabled === true) return true;
  return !isBuildTimePlayStoreFreeze();
}

/** @deprecated Use isApkSideloadInstallEnabled for install gates. */
export function isApkInstallerEnabled() {
  return isApkSideloadInstallEnabled();
}

export function getRemoteApkInstallerState() {
  return {
    remoteSideloadEnabled,
    buildTimePlayStoreFreeze: isBuildTimePlayStoreFreeze(),
    updateCheckEnabled: isApkUpdateCheckEnabled(),
    sideloadInstallEnabled: isApkSideloadInstallEnabled(),
  };
}
