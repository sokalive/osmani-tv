/**
 * Mpingo player.php package authorization from admin channel catalog.
 * When empty, callers must not alter embed headers or injected page state.
 */

import { isProviderEmbedPageUrl } from './embedPlaybackUrl';

/** HTTP header used by Mpingo player.php embed providers. */
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
 * @returns {Record<string, string>}
 */
export function appendAuthorizedPackageHeaders(headers, authorizedPackageName) {
  const pkg = String(authorizedPackageName ?? '').trim();
  const base = headers && typeof headers === 'object' ? { ...headers } : {};
  if (!pkg) return base;
  base[AUTHORIZED_PACKAGE_HEADER] = pkg;
  base['Authorized-Package-Name'] = pkg;
  return base;
}

/**
 * Referer / origin / UA only — never includes authorized package name.
 *
 * @param {Record<string, unknown> | null | undefined} channel
 * @returns {Record<string, string>}
 */
export function buildBasePlaybackHeaders(channel) {
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
  return headers;
}

/**
 * Embed WebView headers for Mpingo player.php only.
 * Exo / hls.js / stream-direct must use {@link buildBasePlaybackHeaders} instead.
 *
 * @param {Record<string, unknown> | null | undefined} channel
 * @param {unknown} embedUri
 * @returns {Record<string, string>}
 */
export function buildMpingoEmbedPlaybackHeaders(channel, embedUri) {
  const base = buildBasePlaybackHeaders(channel);
  const uri = String(embedUri ?? '').trim();
  if (!uri || !isProviderEmbedPageUrl(uri)) return base;
  const pkg = readAuthorizedPackageName(channel);
  if (!pkg) return base;
  return appendAuthorizedPackageHeaders(base, pkg);
}

/**
 * @param {Record<string, unknown> | null | undefined} channel
 * @param {unknown} embedUri
 * @returns {string}
 */
export function readMpingoEmbedAuthorizedPackageName(channel, embedUri) {
  const uri = String(embedUri ?? '').trim();
  if (!uri || !isProviderEmbedPageUrl(uri)) return '';
  return readAuthorizedPackageName(channel);
}
