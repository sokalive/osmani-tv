/**
 * Play Store VPS migration — native versionCode is authoritative (survives OTA).
 *
 * - vc >= 16: OTA-capable Play builds → force VPS via JS after migration OTA
 * - vc >= 23: native production AAB embeds VPS HTTPS
 * - vc 15 and below: no expo-updates — cannot OTA-migrate; stays on Render embed
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

export const VPS_PRODUCTION_API_URL = 'https://api.osmanitv.com';
export const RENDER_PRODUCTION_API_URL = 'https://osmani-admin-api.onrender.com';

/** First Play build with expo-updates (versionCode 16 / runtime 1.6.0). */
export const PLAY_OTA_MIN_VERSION_CODE = 16;

/** Native VPS HTTPS embed in production AAB (versionCode 23+). */
export const PLAY_VPS_NATIVE_MIN_VERSION_CODE = 23;

/** Play Store v1.8.2 / runtime 1.8.2 production release. */
export const PLAY_V24_VERSION_CODE = 24;

/** @deprecated Use PLAY_VPS_NATIVE_MIN_VERSION_CODE */
export const PLAY_VPS_MIN_VERSION_CODE = PLAY_VPS_NATIVE_MIN_VERSION_CODE;

/**
 * @returns {number|null}
 */
export function readNativeAndroidVersionCode() {
  try {
    if (Platform.OS === 'android') {
      const fromApp = Number(Application.nativeBuildVersion);
      if (Number.isFinite(fromApp) && fromApp > 0) return fromApp;
    }
  } catch {
    // ignore
  }
  try {
    const fromConfig = Number(Constants.expoConfig?.android?.versionCode);
    if (Number.isFinite(fromConfig) && fromConfig > 0) return fromConfig;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Play builds that should route admin API to VPS (OTA migration + native VPS).
 *
 * @returns {boolean}
 */
export function isPlayStoreVpsBuild() {
  const vc = readNativeAndroidVersionCode();
  if (vc != null && vc >= PLAY_OTA_MIN_VERSION_CODE) return true;
  return false;
}

/**
 * Native Play builds with VPS HTTPS baked into the APK (no embedded Render migration).
 *
 * @returns {boolean}
 */
export function isNativeVpsPlayRelease() {
  const vc = readNativeAndroidVersionCode();
  return vc != null && vc >= PLAY_VPS_NATIVE_MIN_VERSION_CODE;
}

/**
 * @returns {boolean}
 */
export function isOtaCapablePlayBuild() {
  const vc = readNativeAndroidVersionCode();
  return vc != null && vc >= PLAY_OTA_MIN_VERSION_CODE;
}

/**
 * @returns {string|null}
 */
export function forcedPlayVpsApiBaseUrl() {
  return isPlayStoreVpsBuild() ? VPS_PRODUCTION_API_URL : null;
}

/**
 * @param {string} urlOrBase
 * @returns {boolean}
 */
export function isRenderHostUrl(urlOrBase) {
  return /onrender\.com/i.test(String(urlOrBase ?? ''));
}

/**
 * @param {string} resolvedBase
 * @returns {{ ok: boolean; host: string; versionCode: number|null; forcedVps: boolean }}
 */
export function probeApiHostRouting(resolvedBase) {
  const versionCode = readNativeAndroidVersionCode();
  const host = (() => {
    try {
      return new URL(resolvedBase).host.toLowerCase();
    } catch {
      return String(resolvedBase ?? '');
    }
  })();
  const forcedVps = isPlayStoreVpsBuild();
  const ok = !forcedVps || !isRenderHostUrl(resolvedBase);
  return { ok, host, versionCode, forcedVps };
}

/**
 * @param {string} url
 * @param {string} [tag]
 */
export function guardProductionFetchUrl(url, tag = 'fetch') {
  if (isPlayStoreVpsBuild() && isRenderHostUrl(url)) {
    const msg = `blocked_render_fetch_on_vps_build tag=${tag} url=${url}`;
    console.error('[api-fetch]', JSON.stringify({ phase: 'blocked', url, tag, msg }));
    throw new Error(msg);
  }
}
