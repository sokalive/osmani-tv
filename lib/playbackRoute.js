import { isProviderEmbedPageUrl } from './embedPlaybackUrl';
import { looksLikeHlsPlaybackUri } from './hlsPlayback';

/** @typedef {'native' | 'hls-webview' | 'embed-webview'} PlaybackRoute */

/**
 * Route playback by URL shape + admin playerType.
 *
 * - exo / vlc / native / ijk + HLS or direct media → native (ExoPlayer via expo-av)
 * - webview + HLS → hls.js WebView shell
 * - player.php / embed pages → embed WebView (never Exo)
 * - webview + non-HLS non-embed → embed WebView
 *
 * @param {unknown} url
 * @param {'exo' | 'webview' | 'vlc' | 'native' | 'ijk'} playerTypeNorm
 * @returns {PlaybackRoute}
 */
export function pickPlaybackRoute(url, playerTypeNorm) {
  const s = String(url ?? '').trim();
  if (!s) return 'embed-webview';

  if (isProviderEmbedPageUrl(s)) {
    return 'embed-webview';
  }

  if (looksLikeHlsPlaybackUri(s)) {
    if (playerTypeNorm === 'webview') return 'hls-webview';
    return 'native';
  }

  const lower = s.split(/[#?]/)[0].toLowerCase();
  if (/\.mp4$/i.test(lower)) return 'native';
  if (/\.(?:m2ts|mts|ts)$/i.test(lower)) return 'native';

  return 'embed-webview';
}

/**
 * @param {'exo' | 'webview' | 'vlc' | 'native' | 'ijk'} playerTypeNorm
 * @returns {boolean}
 */
export function playerTypeUsesNativeEngine(playerTypeNorm) {
  return playerTypeNorm === 'exo' || playerTypeNorm === 'vlc' || playerTypeNorm === 'native' || playerTypeNorm === 'ijk';
}
