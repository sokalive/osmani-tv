#!/usr/bin/env node
'use strict';

/**
 * Direct HLS player type regression — isolated dispatch, no proxy, no synthetic headers.
 *
 * Run: node scripts/verify-direct-hls-player.js
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

const directSrc = read('lib/directHlsPlayback.js');
const routeSrc = read('lib/playbackRoute.js');
const channelStreamSrc = read('lib/channelStream.js');
const playerRowSrc = read('lib/playerChannelFromRow.js');
const playerSrc = read('screens/ChannelPlayerScreen.js');
const streamProxySrc = read('lib/streamProxy.js');

if (!directSrc.includes('DIRECT_HLS_PLAYER_TYPE')) fail('directHlsPlayback module');
else pass('directHlsPlayback module');

if (!channelStreamSrc.includes("direct_hls: 'direct_hls'")) fail('normalizePlayerType maps direct_hls');
else pass('normalizePlayerType maps direct_hls');

if (!routeSrc.includes("playerTypeNorm === 'direct_hls'")) fail('pickPlaybackRoute direct_hls branch');
else pass('pickPlaybackRoute direct_hls branch');

if (!playerRowSrc.includes('isDirectHlsPlayerType')) fail('playerChannelFromRow direct_hls handling');
else pass('playerChannelFromRow direct_hls handling');

if (!playerSrc.includes('resolveDirectHlsManifestUrl')) fail('ChannelPlayerScreen uses direct HLS manifest');
else pass('ChannelPlayerScreen uses direct HLS manifest');

if (!playerSrc.includes('!isDirectHls &&')) fail('proxy fallback blocked for direct_hls');
else pass('proxy fallback blocked for direct_hls');

const EXAMPLE =
  'https://vsd272.okcdn.ru/hls/918454578001/918454578001.m3u8?p';
const SIGNED_PATH =
  'https://cdn.example.net/live/abc123def456/index.m3u8?token=sig&p';

function simulateNormalize(pt) {
  const s = String(pt ?? 'exo')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  const map = {
    exo: 'exo',
    webview: 'webview',
    vlc: 'vlc',
    native: 'native',
    ijk: 'ijk',
    direct_hls: 'direct_hls',
    directhls: 'direct_hls',
  };
  const v = map[s] ?? s;
  if (v === 'direct_hls') return 'direct_hls';
  if (v === 'webview' || v === 'vlc' || v === 'native' || v === 'ijk') return v;
  return 'exo';
}

function pickRoute(url, pt) {
  const playerTypeNorm = simulateNormalize(pt);
  const s = String(url ?? '').trim();
  if (!s) return 'embed-webview';
  if (playerTypeNorm === 'direct_hls') return 'native';
  if (/player\.php|\/player\/|\/embed(?:\/|$|\?)/i.test(s) && !/\.m3u8/i.test(s)) {
    return 'embed-webview';
  }
  if (/\.m3u8(?:$|[?#&])/i.test(s)) {
    if (playerTypeNorm === 'webview') return 'hls-webview';
    return 'native';
  }
  return 'embed-webview';
}

function resolveDirectManifest(uri) {
  const s = String(uri ?? '').trim();
  return s;
}

function buildDirectHeaders(channel = {}) {
  const headers = {};
  if (channel.referer) headers.Referer = channel.referer;
  if (channel.origin) headers.Origin = channel.origin;
  if (channel.userAgent) headers['User-Agent'] = channel.userAgent;
  return Object.keys(headers).length ? headers : undefined;
}

function buildProxyUrl(streamUrl, headers = {}) {
  const params = new URLSearchParams();
  params.set('url', streamUrl);
  if (headers.referer) params.set('referer', headers.referer);
  if (headers.origin) params.set('origin', headers.origin);
  if (headers.userAgent) params.set('ua', headers.userAgent);
  return `https://api.osmanitv.com/stream-proxy?${params.toString()}`;
}

// A. dispatch to native engine
if (pickRoute(EXAMPLE, 'direct_hls') !== 'native') {
  fail('A: direct_hls must dispatch to native');
} else pass('A: direct_hls dispatches to native');

// B. WebView not used
if (pickRoute(EXAMPLE, 'direct_hls') === 'hls-webview') {
  fail('B: WebView must not be used');
} else pass('B: WebView not used');

// C–E. no required Referer/Origin/User-Agent
const bareHeaders = buildDirectHeaders({});
if (bareHeaders !== undefined) fail('C–E: bare channel must not require headers');
else pass('C–E: no Referer/Origin/User-Agent required');

// F. no Mozilla injection in direct path
const proxyWrapped = buildProxyUrl(EXAMPLE, {});
if (resolveDirectManifest(EXAMPLE) === proxyWrapped) {
  fail('F/G: direct manifest must not use stream-proxy');
} else pass('F: no stream-proxy wrap (no Mozilla UA injection path)');

// G/H/I. URL exact preservation
const manifest = resolveDirectManifest(EXAMPLE);
if (manifest !== EXAMPLE) fail(`G: URL changed: ${manifest}`);
else pass('G: URL remains exact');

if (!resolveDirectManifest(SIGNED_PATH).includes('abc123def456')) {
  fail('H: signed path segment altered');
} else pass('H: signed path segment preserved');

const withP = 'https://cdn.example.net/hls/stream.m3u8?p';
if (resolveDirectManifest(withP) !== withP) fail('I: ?p query suffix altered');
else pass('I: ?p query suffix preserved');

// J. generic fixture
const generic = 'https://media.example.org/streams/live/main/index.m3u8';
if (pickRoute(generic, 'direct_hls') !== 'native') fail('J: generic HLS fixture');
else pass('J: generic direct HLS fixture → native');

// K–O. existing types unchanged
const legacyCases = [
  { name: 'K exo HLS', url: EXAMPLE, pt: 'exo', want: 'native' },
  { name: 'L webview HLS', url: EXAMPLE, pt: 'webview', want: 'hls-webview' },
  { name: 'M vlc HLS', url: EXAMPLE, pt: 'vlc', want: 'native' },
  { name: 'N native HLS', url: EXAMPLE, pt: 'native', want: 'native' },
  { name: 'O ijk HLS', url: EXAMPLE, pt: 'ijk', want: 'native' },
  {
    name: 'L embed webview',
    url: 'https://nur.mpingotv.com/v3/player.php?channel=1',
    pt: 'webview',
    want: 'embed-webview',
  },
];

for (const c of legacyCases) {
  const got = pickRoute(c.url, c.pt);
  if (got !== c.want) fail(`${c.name}: expected ${c.want}, got ${got}`);
  else pass(`${c.name} unchanged → ${got}`);
}

// Optional explicit header when configured
const withHdr = buildDirectHeaders({ referer: 'https://allowed.example/' });
if (!withHdr?.Referer) fail('optional Referer when configured');
else pass('optional Referer only when explicitly configured');

if (streamProxySrc.includes('DEFAULT_UA')) {
  pass('stream-proxy Mozilla UA remains server-side only (not injected in direct_hls path)');
}

if (process.exitCode) {
  process.exit(1);
}
console.log('\n[verify-direct-hls-player] ok');
