import * as Linking from 'expo-linking';
import * as OsmaniUpdate from '../modules/osmani-update';

const LANDING_INSTALL_HOSTS = new Set(['osmani-tv-landing.vercel.app']);
const LANDING_INSTALL_PATH = '/install';
const APK_HOST_ALLOWLIST = new Set(['osmani-tv-apk-download.b-cdn.net']);

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isLandingInstallUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'osmani:' && parsed.hostname === 'install') {
      return Boolean(parsed.searchParams.get('apk'));
    }
    if (!LANDING_INSTALL_HOSTS.has(parsed.hostname)) return false;
    return parsed.pathname.startsWith(LANDING_INSTALL_PATH);
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedLandingInstallUrl(url) {
  if (!isLandingInstallUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const apk = parsed.searchParams.get('apk');
    if (!apk) return false;
    const apkUrl = new URL(apk);
    return (
      apkUrl.protocol === 'https:' &&
      APK_HOST_ALLOWLIST.has(apkUrl.hostname) &&
      apkUrl.pathname.toLowerCase().endsWith('.apk')
    );
  } catch {
    return false;
  }
}

/**
 * Handle warm-start landing install links while the app is already running.
 * Cold start is handled by LandingInstallActivity in the native module.
 *
 * @param {string} url
 */
export async function handleLandingInstallUrl(url) {
  if (!isAllowedLandingInstallUrl(url)) {
    console.warn('[landing-install] rejected url', url);
    return;
  }
  try {
    await OsmaniUpdate.handleLandingInstallLink(url);
  } catch (error) {
    console.warn('[landing-install] failed', error);
  }
}

/**
 * @param {(url: string) => void} onUrl
 * @returns {() => void}
 */
export function subscribeLandingInstallLinks(onUrl) {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (isAllowedLandingInstallUrl(url)) onUrl(url);
  });
  return () => subscription.remove();
}

/**
 * Flush cold-start URL if React mounted before native activity handed off.
 */
export async function flushInitialLandingInstallUrl() {
  const initial = await Linking.getInitialURL();
  if (initial && isAllowedLandingInstallUrl(initial)) {
    await handleLandingInstallUrl(initial);
  }
}
