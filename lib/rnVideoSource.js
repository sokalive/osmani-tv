/**
 * react-native-video source + ExoPlayer buffer/live tuning (Android).
 * See: https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/
 */

/**
 * Explicit live playback parameters map to Media3 LiveConfiguration:
 * targetOffsetMs, min/max offset envelope, playback speed slack for drift correction.
 */
export const EXO_LIVE_BUFFER_CONFIG = {
  minBufferMs: 2000,
  maxBufferMs: 12000,
  bufferForPlaybackMs: 1000,
  bufferForPlaybackAfterRebufferMs: 1500,
  /** Minimal DVR rewind; reduces attachment to stale window head. */
  backBufferDurationMs: 8000,
  cacheSizeMB: 0,
  live: {
    targetOffsetMs: 1200,
    minOffsetMs: 450,
    maxOffsetMs: 8000,
    minPlaybackSpeed: 0.95,
    maxPlaybackSpeed: 1.06,
  },
};

/**
 * @param {Record<string, string>} [headers] — e.g. Referer, Origin, User-Agent
 */
export function buildRnVideoSource(uri, headers = {}, opts = {}) {
  const { forceHlsContentType } = opts;
  if (!uri) return undefined;
  const hasHeaders = headers && typeof headers === 'object' && Object.keys(headers).length > 0;
  const lower = String(uri).toLowerCase();
  const isHls = /\.m3u8(?:\?|$)/i.test(lower) || forceHlsContentType;

  const source = {
    uri,
    ...(hasHeaders ? { headers } : {}),
    ...(isHls
      ? {
          type: 'm3u8',
          bufferConfig: EXO_LIVE_BUFFER_CONFIG,
        }
      : {}),
  };

  return source;
}
