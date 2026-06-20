/**
 * Play Store VPS migration (versionCode 23+ / runtime 1.8.x).
 * Native versionCode is authoritative — survives OTA even when JS env is wrong.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

export const VPS_PRODUCTION_API_URL = 'https://api.osmanitv.com';
export const RENDER_PRODUCTION_API_URL = 'https://osmani-admin-api.onrender.com';

const PLAY_VPS_MIN_VERSION_CODE = 23;

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
 * @returns {boolean}
 */
export function isPlayStoreVpsBuild() {
  const vc = readNativeAndroidVersionCode();
  if (vc != null && vc >= PLAY_VPS_MIN_VERSION_CODE) return true;
  try {
    const ver = String(Constants.expoConfig?.version ?? '').trim();
    return /^1\.8(\.|$)/.test(ver);
  } catch {
    return false;
  }
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

export { PLAY_VPS_MIN_VERSION_CODE };
