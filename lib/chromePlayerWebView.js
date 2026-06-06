/**
 * Chromium-class WebView settings for admin `playerType: chrome` (Mpingo Widevine).
 * Uses Android System WebView via react-native-webview with full browser EME features.
 */

const DEFAULT_CHROME_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * Shared react-native-webview props for the Chrome player surface.
 * @type {Record<string, unknown>}
 */
export const CHROME_WEBVIEW_PROPS = Object.freeze({
  allowsInlineMediaPlayback: true,
  mediaPlaybackRequiresUserAction: false,
  javaScriptEnabled: true,
  domStorageEnabled: true,
  cacheEnabled: true,
  thirdPartyCookiesEnabled: true,
  sharedCookiesEnabled: true,
  originWhitelist: ['*'],
  mixedContentMode: 'always',
  setSupportMultipleWindows: true,
  javaScriptCanOpenWindowsAutomatically: true,
  allowsFullscreenVideo: true,
  androidLayerType: 'hardware',
});

/**
 * @param {string} [channelUserAgent]
 * @returns {string | undefined}
 */
export function resolveChromeUserAgent(channelUserAgent) {
  const custom = String(channelUserAgent ?? '').trim();
  return custom || DEFAULT_CHROME_MOBILE_UA;
}

/**
 * @param {string} uri
 * @param {Record<string, string>} headers
 * @returns {{ uri: string; headers?: Record<string, string>; baseUrl?: string }}
 */
export function buildChromeWebViewSource(uri, headers = {}) {
  const u = String(uri ?? '').trim();
  const hEntries = Object.entries(headers).filter(([, v]) => v != null && String(v).trim() !== '');
  if (!hEntries.length) return { uri: u };
  return { uri: u, headers: Object.fromEntries(hEntries) };
}
