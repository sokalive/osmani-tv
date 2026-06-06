/**
 * Mpingo-compatible authorized package name from admin channel catalog.
 * When empty, callers must not alter playback headers or injected page state.
 */

/** HTTP header used by several embed providers (including Mpingo player.php). */
export const AUTHORIZED_PACKAGE_HEADER = 'X-Package-Name';

/**
 * @param {Record<string, unknown> | null | undefined} source
 * @returns {string}
 */
export function readAuthorizedPackageName(source) {
  if (!source || typeof source !== 'object') return '';
  const raw =
    source.authorizedPackageName ??
    source.authorized_package_name ??
    source.authorizedPackage ??
    source.authorized_package ??
    '';
  return String(raw ?? '').trim();
}

/**
 * @param {Record<string, string>} [headers]
 * @param {string} [authorizedPackageName]
 * @returns {Record<string, string> | undefined}
 */
export function appendAuthorizedPackageHeaders(headers, authorizedPackageName) {
  const pkg = String(authorizedPackageName ?? '').trim();
  if (!pkg) return headers;
  const base = headers && typeof headers === 'object' ? { ...headers } : {};
  base[AUTHORIZED_PACKAGE_HEADER] = pkg;
  base['Authorized-Package-Name'] = pkg;
  return base;
}

/**
 * Build playback request headers for Exo / WebView / Chrome surfaces.
 *
 * @param {Record<string, unknown> | null | undefined} channel
 * @returns {Record<string, string>}
 */
export function buildPlaybackRequestHeaders(channel) {
  if (!channel || typeof channel !== 'object') return {};
  const headers = {};
  const referer = typeof channel.referer === 'string' ? channel.referer.trim() : '';
  const origin = typeof channel.origin === 'string' ? channel.origin.trim() : '';
  const userAgent =
    typeof channel.userAgent === 'string'
      ? channel.userAgent.trim()
      : typeof channel.user_agent === 'string'
        ? channel.user_agent.trim()
        : '';
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  if (userAgent) headers['User-Agent'] = userAgent;
  return appendAuthorizedPackageHeaders(headers, readAuthorizedPackageName(channel)) ?? headers;
}
