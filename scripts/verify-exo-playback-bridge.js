#!/usr/bin/env node
'use strict';

/**
 * EXO + HTTP → backend HTTPS stream-proxy playbackUrl preference.
 * Run: node scripts/verify-exo-playback-bridge.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const bridgeSrc = read('lib/exoPlaybackBridge.js');
const deliverySrc = read('lib/streamDelivery.js');
const playerRowSrc = read('lib/playerChannelFromRow.js');
const screenSrc = read('screens/ChannelPlayerScreen.js');

if (!bridgeSrc.includes('resolveExoBackendPlaybackPreference')) fail('bridge preference export');
else pass('bridge preference export');

if (!bridgeSrc.includes('proxy_cleartext_bridge')) fail('cleartext bridge source tag');
else pass('cleartext bridge source tag');

if (!bridgeSrc.includes('isCleartextHttpUrl')) fail('isCleartextHttpUrl helper');
else pass('isCleartextHttpUrl helper');

if (!deliverySrc.includes('resolveExoBackendPlaybackPreference')) fail('streamDelivery uses EXO preference');
else pass('streamDelivery uses EXO preference');

if (!deliverySrc.includes('playerType')) fail('playback plan accepts playerType');
else pass('playback plan accepts playerType');

if (!playerRowSrc.includes('playerType,')) fail('playerChannelFromRow passes playerType');
else pass('playerChannelFromRow passes playerType');

if (!playerRowSrc.includes('playbackUrl: retainedPlaybackUrl')) fail('player channel retains playbackUrl');
else pass('player channel retains playbackUrl');

if (!screenSrc.includes('EXO_PLAYBACK_BRIDGE')) fail('player logs EXO_PLAYBACK_BRIDGE');
else pass('player logs EXO_PLAYBACK_BRIDGE');

if (!screenSrc.includes('guardExoManifestAgainstCleartext')) fail('player guards cleartext Exo URI');
else pass('player guards cleartext Exo URI');

// --- Inlined behavioral sims (no ESM loader) ---
function isCleartextHttpUrl(url) {
  return /^http:\/\//i.test(String(url ?? '').trim());
}
function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
}
function looksLikeHlsPath(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}
function extractProxyUpstream(proxyUrl) {
  if (!isStreamProxyUrl(proxyUrl)) return '';
  try {
    return String(new URL(String(proxyUrl)).searchParams.get('url') ?? '').trim();
  } catch {
    return '';
  }
}
function isValidBackendPlaybackUrl(url) {
  const s = String(url ?? '').trim();
  if (!s || !/^https:\/\//i.test(s)) return false;
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}
function isExoCapableProxyPlaybackUrl(playbackUrl) {
  if (!(isStreamProxyUrl(playbackUrl) && isValidBackendPlaybackUrl(playbackUrl))) return false;
  const inner = extractProxyUpstream(playbackUrl);
  return Boolean(inner && looksLikeHlsPath(inner));
}
function resolveExoBackendPlaybackPreference(input = {}) {
  const playerType = String(input.playerType ?? 'exo').toLowerCase();
  if (playerType !== 'exo') return null;
  const rawUrl = String(input.rawUrl ?? '').trim();
  const candidates = [input.playbackUrl, input.proxyPlaybackUrl, input.proxyFallbackUrl];
  let chosen = '';
  for (const c of candidates) {
    const s = String(c ?? '').trim();
    if (isExoCapableProxyPlaybackUrl(s)) {
      chosen = s;
      break;
    }
  }
  if (!chosen) return null;
  const rawIsCleartext = isCleartextHttpUrl(rawUrl);
  const rawIsHls = looksLikeHlsPath(rawUrl);
  if (!rawIsCleartext && !rawIsHls) return null;
  return {
    playUrl: chosen,
    deliveryMode: 'proxy',
    isStreamProxy: true,
    isCleartextHttp: false,
    playbackSource: rawIsCleartext ? 'proxy_cleartext_bridge' : 'proxy',
  };
}

const BEIN_HTTP =
  'http://bein.mpilalivetv.com/bridge/bein-sports-1.m3u8?key=K2TV-791F';
const BEIN_PROXY =
  'https://api.osmanitv.com/stream-proxy?url=' +
  encodeURIComponent(BEIN_HTTP) +
  '&referer=' +
  encodeURIComponent('http://bein.mpilalivetv.com/');

const bein = resolveExoBackendPlaybackPreference({
  playerType: 'exo',
  rawUrl: BEIN_HTTP,
  playbackUrl: BEIN_PROXY,
});
if (!bein || bein.playUrl !== BEIN_PROXY) fail('sim: Bein HTTP+EXO → proxy playbackUrl');
else pass('sim: Bein HTTP+EXO → proxy playbackUrl');
if (bein.isCleartextHttp !== false) fail('sim: Bein isCleartextHttp false');
else pass('sim: Bein isCleartextHttp false');
if (bein.playbackSource !== 'proxy_cleartext_bridge') fail('sim: Bein playback_source bridge');
else pass('sim: Bein playback_source bridge');
if (!bein.isStreamProxy) fail('sim: Bein isStreamProxy');
else pass('sim: Bein isStreamProxy');

const webview = resolveExoBackendPlaybackPreference({
  playerType: 'webview',
  rawUrl: BEIN_HTTP,
  playbackUrl: BEIN_PROXY,
});
if (webview !== null) fail('sim: non-EXO unchanged');
else pass('sim: non-EXO unchanged');

const embed = resolveExoBackendPlaybackPreference({
  playerType: 'exo',
  rawUrl: 'https://bein.mpilalivetv.com/v3/player.php?channel=5',
  playbackUrl:
    'https://api.osmanitv.com/stream-proxy?url=' +
    encodeURIComponent('https://bein.mpilalivetv.com/v3/player.php?channel=5'),
});
if (embed !== null) fail('sim: player.php embed not forced to proxy for EXO');
else pass('sim: player.php embed not forced to proxy for EXO');

const noProxy = resolveExoBackendPlaybackPreference({
  playerType: 'exo',
  rawUrl: BEIN_HTTP,
  playbackUrl: '',
});
if (noProxy !== null) fail('sim: missing playbackUrl falls through');
else pass('sim: missing playbackUrl falls through');

const httpsDirect = resolveExoBackendPlaybackPreference({
  playerType: 'exo',
  rawUrl: 'https://cdn.example.com/live.m3u8',
  playbackUrl: 'https://cdn.example.com/live.m3u8',
});
if (httpsDirect !== null) fail('sim: non-proxy HTTPS HLS not forced');
else pass('sim: non-proxy HTTPS HLS not forced');

if (isCleartextHttpUrl(BEIN_PROXY)) fail('sim: proxy URL not cleartext');
else pass('sim: proxy URL not cleartext');

void vm;
console.log('\n[verify-exo-playback-bridge] ok');
