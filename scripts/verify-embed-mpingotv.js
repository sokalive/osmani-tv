#!/usr/bin/env node
'use strict';

/**
 * Ensures mpingotv/player.php channels keep embed-webview + upstream player.php URL.
 * HLS (.m3u8) channels must still use stream-direct / proxy (unchanged).
 *
 * Run: node scripts/verify-embed-mpingotv.js
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

const deliverySrc = read('lib/streamDelivery.js');
const playerSrc = read('screens/ChannelPlayerScreen.js');
const bridgeSrc = read('lib/embedBridgeJs.js');

if (!deliverySrc.includes('isProviderEmbedPageUrl')) {
  fail('isProviderEmbedPageUrl missing');
} else pass('isProviderEmbedPageUrl defined');

if (!deliverySrc.includes('resolveProviderEmbedPageUrl')) {
  fail('embed pages must resolve upstream URL');
} else pass('embed pages resolve upstream URL');

if (playerSrc.includes('pickOsmaniPlaybackRoute')) {
  fail('Osmani-only forced route must not be present');
} else pass('no Osmani-only forced route');

if (!playerSrc.includes('useEmbedWebView')) {
  fail('embed-webview path missing');
} else pass('embed-webview path present');

if (!playerSrc.includes('embed_playback_started')) {
  fail('embed playback start handshake missing');
} else pass('embed playback start handshake');

if (!bridgeSrc.includes('buildEmbedPageBootstrapJs')) {
  fail('embed page bootstrap missing');
} else pass('embed page bootstrap');

if (!playerSrc.includes('injectedJavaScriptBeforeContentLoaded={embedPageBootstrapJs}')) {
  fail('embed bootstrap not wired into WebView');
} else pass('embed bootstrap wired');

// Static routing sanity (inline — mirrors lib/streamDelivery.js)
function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
}

function isProviderEmbedPageUrl(url) {
  const inner = unwrapForEmbed(url);
  if (!inner || looksLikeHlsUrl(inner)) return false;
  const pathPart = inner.split(/[#?]/)[0].toLowerCase();
  if (/\.(?:mp4|ts|m2ts|mts)$/i.test(pathPart)) return false;
  return /player\.php|\/player\/|\/embed(?:\/|$|\?)/i.test(inner);
}

function unwrapForEmbed(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  if (isStreamProxyUrl(s)) {
    try {
      return String(new URL(s).searchParams.get('url') ?? '').trim();
    } catch {
      return '';
    }
  }
  if (/\/stream-direct(?:\?|$)/i.test(s)) {
    try {
      const token = new URL(s).searchParams.get('token');
      if (!token) return '';
      for (const part of token.split('.')) {
        try {
          let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
          const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
          b64 += pad;
          const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
          const upstream = String(payload.u ?? payload.url ?? '').trim();
          if (upstream) return upstream;
        } catch {
          /* try next segment */
        }
      }
    } catch {
      return '';
    }
  }
  return s;
}

function resolveChannelPlaybackPlan(input) {
  const rawUrl = String(input.rawUrl ?? '').trim();
  const directUrl = String(input.directStreamUrl ?? '').trim();
  const proxyFallbackUrl = String(input.proxyFallbackUrl ?? '').trim();
  const playUrl = directUrl || proxyFallbackUrl;
  for (const candidate of [rawUrl, playUrl, directUrl, proxyFallbackUrl]) {
    if (isProviderEmbedPageUrl(candidate)) {
      const inner = unwrapForEmbed(candidate);
      if (inner.startsWith('http')) return { playUrl: inner };
    }
  }
  return { playUrl };
}

const azamRaw = 'https://nur.mpingotv.com/v3/player.php?channel=1';
const beinRaw = 'http://het103b.ycn-redirect.com/live/918454578001/index.m3u8?t=x&e=1';
const directToken = 'https://osmanitv.b-cdn.net/stream-direct?token=abc';

const azamPlan = resolveChannelPlaybackPlan({
  rawUrl: azamRaw,
  directStreamUrl: directToken,
  proxyFallbackUrl: 'https://osmanitv.b-cdn.net/stream-proxy?url=player',
});

const beinPlan = resolveChannelPlaybackPlan({
  rawUrl: beinRaw,
  directStreamUrl: directToken,
  proxyFallbackUrl: 'https://osmanitv.b-cdn.net/stream-proxy?url=m3u8',
});

if (!isProviderEmbedPageUrl(azamRaw)) fail('Azam player.php not detected as embed');
else pass('Azam player.php detected as embed');

if (isProviderEmbedPageUrl(beinRaw)) fail('Bein m3u8 must not be embed page');
else pass('Bein m3u8 not treated as embed page');

if (azamPlan.playUrl !== azamRaw) {
  fail(`Azam playUrl must be raw player.php, got ${azamPlan.playUrl}`);
} else pass('Azam hybrid playUrl stays player.php');

if (beinPlan.playUrl !== directToken) {
  fail(`Bein playUrl must stay stream-direct, got ${beinPlan.playUrl}`);
} else pass('Bein hybrid playUrl stays stream-direct');

const proxyWrappedAzam =
  'https://osmanitv.b-cdn.net/stream-proxy?url=' +
  encodeURIComponent('https://nur.mpingotv.com/v3/player.php?channel=1');
const proxyPlan = resolveChannelPlaybackPlan({
  rawUrl: proxyWrappedAzam,
  directStreamUrl: directToken,
  proxyFallbackUrl: proxyWrappedAzam,
});
if (proxyPlan.playUrl !== azamRaw) {
  fail(`proxy-wrapped player.php must unwrap, got ${proxyPlan.playUrl}`);
} else pass('proxy-wrapped player.php unwraps to upstream');

if (!bridgeSrc.includes('function detectShaka()')) {
  fail('embed bridge must detect Shaka Player (MpingoTV DASH)');
} else pass('embed bridge detects Shaka Player');

if (!bridgeSrc.includes('function detectHlsJs()')) {
  fail('embed bridge must detect HLS.js (MpingoTV HLS)');
} else pass('embed bridge detects HLS.js');

if (!playerSrc.includes('useNativePlayer') || !playerSrc.includes('Channel hii haina quality za kuchagua.')) {
  fail('native-only empty quality feedback missing');
} else pass('native-only empty quality feedback present');

if (!playerSrc.includes('Channel hii haina sauti za kubadili.')) {
  fail('native-only empty language feedback missing');
} else pass('native-only empty language feedback present');

if (process.exitCode) process.exit(1);
console.log('[verify-embed-mpingotv] ok');
