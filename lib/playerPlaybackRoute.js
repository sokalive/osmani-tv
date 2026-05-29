import { isStreamProxyUrl } from './mediaDelivery';
import { looksLikeHlsPlaybackUri } from './hlsPlayback';

/**
 * Osmani TV playback engines:
 *   osmani-hls — chromeless hls.js WebView (Osmani UI only; no provider controls)
 *   native     — expo-av for progressive (.mp4 / .ts)
 *
 * @param {unknown} url
 * @returns {'osmani-hls' | 'native'}
 */
export function pickOsmaniPlaybackRoute(url) {
  const s = String(url ?? '').trim();
  if (!s) return 'native';
  if (looksLikeHlsPlaybackUri(s)) return 'osmani-hls';
  const lower = s.split(/[#?]/)[0].toLowerCase();
  if (/\.mp4$/i.test(lower)) return 'native';
  if (/\.(?:m2ts|mts|ts)$/i.test(lower)) return 'native';
  if (isStreamProxyUrl(s)) return 'osmani-hls';
  return 'native';
}
