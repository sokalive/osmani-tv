/**
 * @param {Record<string, unknown>} channel
 * @returns {string}
 */
export function resolveStream(channel) {
  if (!channel || typeof channel !== 'object') return '';
  const u = typeof channel.url === 'string' ? channel.url.trim() : '';
  const b1 = typeof channel.backupStream1 === 'string' ? channel.backupStream1.trim() : '';
  const b2 = typeof channel.backupStream2 === 'string' ? channel.backupStream2.trim() : '';
  return u || b1 || b2;
}

/**
 * @param {Record<string, unknown>} channel
 * @returns {Record<string, string> | undefined}
 */
export function buildStreamRequestHeaders(channel) {
  if (!channel || typeof channel !== 'object') return undefined;
  const headers = {};
  const referer = typeof channel.referer === 'string' ? channel.referer.trim() : '';
  const origin = typeof channel.origin === 'string' ? channel.origin.trim() : '';
  const userAgent = typeof channel.userAgent === 'string' ? channel.userAgent.trim() : '';
  const accept = typeof channel.accept === 'string' ? channel.accept.trim() : '';
  const connection = typeof channel.connection === 'string' ? channel.connection.trim() : '';
  const custom =
    channel.headers && typeof channel.headers === 'object' && !Array.isArray(channel.headers)
      ? channel.headers
      : null;
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  if (userAgent) headers['User-Agent'] = userAgent;
  if (accept) headers.Accept = accept;
  if (connection) headers.Connection = connection;
  if (!headers.Accept) headers.Accept = 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*';
  if (!headers.Connection) headers.Connection = 'keep-alive';
  if (custom) {
    Object.keys(custom).forEach((k) => {
      const v = custom[k];
      if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) {
        headers[k.trim()] = v.trim();
      }
    });
  }
  return Object.keys(headers).length ? headers : undefined;
}

/**
 * @param {unknown} pt
 * @returns {'exo' | 'webview' | 'vlc' | 'native' | 'ijk' | 'direct_hls'}
 */
export function normalizePlayerType(pt) {
  const s = String(pt ?? 'exo')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  const map = {
    exo: 'exo',
    exoplayer: 'exo',
    webview: 'webview',
    vlc: 'vlc',
    native: 'native',
    ijk: 'ijk',
    ijkplayer: 'ijk',
    direct_hls: 'direct_hls',
    directhls: 'direct_hls',
  };
  const v = map[s] ?? s;
  if (v === 'direct_hls') return 'direct_hls';
  if (v === 'webview' || v === 'vlc' || v === 'native' || v === 'ijk') return v;
  return 'exo';
}
