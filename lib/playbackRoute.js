/** Mirror lib/hlsPlayback.js — kept local so Node verify scripts can require this module. */
function looksLikeHlsPlaybackUri(uri) {
  const s = String(uri ?? '').trim();
  if (!s) return false;
  if (/\.m3u8(?:$|[?#&])/i.test(s)) return true;
  if (/\/stream-direct(?:\?|$)/i.test(s)) return true;
  if (/\/stream-proxy(?:\?|$)/i.test(s)) {
    try {
      const inner = String(new URL(s).searchParams.get('url') ?? '').trim();
      if (inner && /\.m3u8(?:$|[?#&])/i.test(inner)) return true;
    } catch {
      /* ignore */
    }
    return /\.m3u8(?:$|[?#&])/i.test(decodeURIComponent(s));
  }
  return false;
}

/**
 * Pick a playback engine route from URL + normalized admin playerType.
 *
 * @param {string} url
 * @param {'exo' | 'webview' | 'vlc' | 'native' | 'ijk' | 'chrome'} playerTypeNorm
 * @returns {'native' | 'hls-webview' | 'embed-webview' | 'chrome-webview'}
 */
export function pickPlaybackRoute(url, playerTypeNorm) {
  const pt = playerTypeNorm;
  const s = String(url ?? '');
  if (!s.trim()) {
    return pt === 'chrome' ? 'chrome-webview' : 'embed-webview';
  }
  const lower = s.split(/[#?]/)[0].toLowerCase();
  if (looksLikeHlsPlaybackUri(s)) {
    if (pt === 'webview') return 'hls-webview';
    if (pt === 'chrome') return 'chrome-webview';
    return 'native';
  }
  if (/\.mp4$/i.test(lower)) {
    if (pt === 'chrome') return 'chrome-webview';
    return 'native';
  }
  if (/\.(?:m2ts|mts|ts)$/i.test(lower)) {
    if (pt === 'chrome') return 'chrome-webview';
    return 'native';
  }
  if (pt === 'chrome') return 'chrome-webview';
  return 'embed-webview';
}
