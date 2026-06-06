#!/usr/bin/env node
'use strict';

/**
 * Mpingo player.php package authorization must stay embed-scoped only.
 * Native Exo / hls.js / stream-direct must never receive X-Package-Name headers.
 *
 * Run: node scripts/verify-mpingo-package-auth.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const playerSrc = read('screens/ChannelPlayerScreen.js');
const channelStreamSrc = read('lib/channelStream.js');
const authSrc = read('lib/authorizedPackageName.js');
const bridgeSrc = read('lib/embedBridgeJs.js');
const rowSrc = read('lib/playerChannelFromRow.js');

if (!fs.existsSync(path.join(root, 'lib/authorizedPackageName.js'))) {
  fail('lib/authorizedPackageName.js missing');
} else pass('authorizedPackageName module present');

if (!authSrc.includes('buildMpingoEmbedPlaybackHeaders')) {
  fail('buildMpingoEmbedPlaybackHeaders missing');
} else pass('scoped embed header builder present');

if (!authSrc.includes('buildBasePlaybackHeaders')) {
  fail('buildBasePlaybackHeaders missing');
} else pass('base playback headers helper present');

if (!authSrc.includes('isProviderEmbedPageUrl')) {
  fail('embed URI guard must use isProviderEmbedPageUrl');
} else pass('embed URI guard uses isProviderEmbedPageUrl');

if (channelStreamSrc.includes('authorizedPackageName') || channelStreamSrc.includes('X-Package-Name')) {
  fail('channelStream must not add package headers (breaks Exo #EXTM3U)');
} else pass('channelStream has no package headers');

if (!playerSrc.includes('buildMpingoEmbedPlaybackHeaders')) {
  fail('ChannelPlayerScreen must use buildMpingoEmbedPlaybackHeaders');
} else pass('ChannelPlayerScreen uses scoped embed headers');

if (!playerSrc.includes('embedPlaybackHeaders')) {
  fail('embedPlaybackHeaders useMemo missing');
} else pass('embedPlaybackHeaders separated from native headers');

if (playerSrc.match(/nativeVideoSource[\s\S]{0,600}embedPlaybackHeaders/)) {
  fail('nativeVideoSource must not use embedPlaybackHeaders');
} else pass('nativeVideoSource does not use embedPlaybackHeaders');

if (playerSrc.match(/hlsWebViewSource[\s\S]{0,400}embedPlaybackHeaders/)) {
  fail('hlsWebViewSource must not use embedPlaybackHeaders');
} else pass('hlsWebViewSource does not use embedPlaybackHeaders');

if (!playerSrc.includes('embedWebViewSource')) {
  fail('embedWebViewSource missing');
} else if (!playerSrc.match(/embedWebViewSource[\s\S]{0,400}embedPlaybackHeaders/)) {
  fail('embedWebViewSource must use embedPlaybackHeaders');
} else pass('embedWebViewSource uses embedPlaybackHeaders');

if (playerSrc.includes('chromePlayerWebView')) {
  fail('Chrome player must not be restored');
} else pass('no Chrome player');

if (!bridgeSrc.includes('__OSMANI_AUTHORIZED_PACKAGE__')) {
  fail('embed bootstrap must expose __OSMANI_AUTHORIZED_PACKAGE__');
} else pass('embed bootstrap exposes authorized package');

if (!playerSrc.includes('readMpingoEmbedAuthorizedPackageName')) {
  fail('readMpingoEmbedAuthorizedPackageName wiring missing');
} else pass('embed bootstrap reads Mpingo-only package name');

if (!rowSrc.includes('authorizedPackageName')) {
  fail('playerChannelFromRow must passthrough authorizedPackageName');
} else pass('playerChannelFromRow passthrough present');

function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

function isProviderEmbedPageUrl(url) {
  const inner = String(url ?? '').trim();
  if (!inner || looksLikeHlsUrl(inner)) return false;
  const pathPart = inner.split(/[#?]/)[0].toLowerCase();
  if (/\.(?:mp4|ts|m2ts|mts)$/i.test(pathPart)) return false;
  return /player\.php|\/player\/|\/embed(?:\/|$|\?)/i.test(inner);
}

function readAuthorizedPackageName(source) {
  if (!source || typeof source !== 'object') return '';
  const raw =
    source.authorizedPackageName ??
    source.authorized_package_name ??
    source.authorizedPackage ??
    source.authorized_package ??
    '';
  return String(raw ?? '').trim();
}

function appendAuthorizedPackageHeaders(headers, authorizedPackageName) {
  const pkg = String(authorizedPackageName ?? '').trim();
  const base = headers && typeof headers === 'object' ? { ...headers } : {};
  if (!pkg) return base;
  base['X-Package-Name'] = pkg;
  base['Authorized-Package-Name'] = pkg;
  return base;
}

function buildBasePlaybackHeaders(channel) {
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

function buildMpingoEmbedPlaybackHeaders(channel, embedUri) {
  const base = buildBasePlaybackHeaders(channel);
  const uri = String(embedUri ?? '').trim();
  if (!uri || !isProviderEmbedPageUrl(uri)) return base;
  const pkg = readAuthorizedPackageName(channel);
  if (!pkg) return base;
  return appendAuthorizedPackageHeaders(base, pkg);
}

const mpingoUri = 'https://nur.mpingotv.com/v3/player.php?channel=1';
const ycnUri = 'http://het103b.ycn-redirect.com/live/918454578001/index.m3u8?t=x&e=1';

const channel = {
  referer: 'https://nur.mpingotv.com/',
  origin: 'https://nur.mpingotv.com',
  authorizedPackageName: 'com.example.app',
};

const base = buildBasePlaybackHeaders(channel);
if (base['X-Package-Name'] || base['Authorized-Package-Name']) {
  fail('buildBasePlaybackHeaders must not include package headers');
} else pass('base headers exclude package name');

const embedHeaders = buildMpingoEmbedPlaybackHeaders(channel, mpingoUri);
if (embedHeaders['X-Package-Name'] !== 'com.example.app') {
  fail('Mpingo embed headers must include X-Package-Name');
} else pass('Mpingo embed headers include X-Package-Name');

const ycnHeaders = buildMpingoEmbedPlaybackHeaders(channel, ycnUri);
if (ycnHeaders['X-Package-Name'] || ycnHeaders['Authorized-Package-Name']) {
  fail('non-embed URI must not receive package headers');
} else pass('non-embed URI excludes package headers');

const emptyPkgHeaders = buildMpingoEmbedPlaybackHeaders(
  { referer: 'https://nur.mpingotv.com/' },
  mpingoUri,
);
if (emptyPkgHeaders['X-Package-Name']) {
  fail('empty authorizedPackageName must not add headers');
} else pass('empty authorizedPackageName adds no package headers');

if (readAuthorizedPackageName({ authorized_package_name: ' pkg ' }) !== 'pkg') {
  fail('readAuthorizedPackageName snake_case trim');
} else pass('readAuthorizedPackageName snake_case trim');

const appended = appendAuthorizedPackageHeaders({}, 'com.test');
if (appended['X-Package-Name'] !== 'com.test' || appended['Authorized-Package-Name'] !== 'com.test') {
  fail('appendAuthorizedPackageHeaders sets both header names');
} else pass('appendAuthorizedPackageHeaders sets both header names');

if (process.exitCode) process.exit(1);
console.log('[verify-mpingo-package-auth] ok');
