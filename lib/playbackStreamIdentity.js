/**
 * Stable playback identity — ignores rotating signed-URL query params (tok, exp, …)
 * so catalog refresh does not remount Exo when only tokens change.
 */

/** @type {readonly string[]} */
const VOLATILE_QUERY_KEYS = Object.freeze([
  'tok',
  'token',
  'e',
  'exp',
  'expires',
  't',
  'signature',
  'sig',
  'nonce',
  'n',
]);

/**
 * @param {unknown} url
 * @returns {string}
 */
export function normalizeUrlForPlaybackIdentity(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    for (const key of [...u.searchParams.keys()]) {
      if (VOLATILE_QUERY_KEYS.includes(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }
    u.hash = '';
    const qs = u.searchParams.toString();
    return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return s.split(/[#?]/)[0];
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} ch
 * @returns {string}
 */
export function playbackStreamIdentity(ch) {
  if (!ch) return '';
  return [
    normalizeUrlForPlaybackIdentity(ch.url),
    normalizeUrlForPlaybackIdentity(ch.directStreamUrl ?? ch.direct_stream_url),
    normalizeUrlForPlaybackIdentity(ch.proxyFallbackUrl ?? ch.proxy_fallback_url),
    normalizeUrlForPlaybackIdentity(ch.backupStream1 ?? ch.backup_stream_1),
    normalizeUrlForPlaybackIdentity(ch.backupStream2 ?? ch.backup_stream_2),
    String(ch.streamDeliveryMode ?? ch.stream_delivery_mode ?? ''),
    String(ch.playerType ?? ch.player_type ?? ''),
    String(ch.authorizedPackageName ?? ch.authorized_package_name ?? ''),
  ].join('|');
}
