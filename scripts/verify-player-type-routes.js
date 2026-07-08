#!/usr/bin/env node
'use strict';

/**
 * Verify playerType → playback route independence and stream-direct CDN exemption.
 *
 * Run: node scripts/verify-player-type-routes.js
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

const mediaSrc = read('lib/mediaDelivery.js');
const routeSrc = read('lib/playbackRoute.js');
const playerSrc = read('screens/ChannelPlayerScreen.js');

if (!mediaSrc.includes('isStreamDirectUrl')) fail('isStreamDirectUrl helper');
else pass('isStreamDirectUrl helper');

if (!mediaSrc.includes('if (isStreamDirectUrl(s))')) fail('stream-direct CDN rewrite blocked');
else pass('stream-direct CDN rewrite blocked');

if (!routeSrc.includes('pickPlaybackRoute')) fail('playbackRoute module');
else pass('playbackRoute module');

if (!playerSrc.includes("from '../lib/playbackRoute'")) fail('ChannelPlayerScreen uses playbackRoute');
else pass('ChannelPlayerScreen uses playbackRoute');

if (playerSrc.includes('function pickPlaybackRoute')) fail('inline pickPlaybackRoute removed');
else pass('inline pickPlaybackRoute removed');

function looksLikeHlsPath(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
}

function isStreamDirectUrl(input) {
  return /\/stream-direct(?:\?|$)/i.test(String(input ?? ''));
}

function rewriteRenderToCdn(url) {
  if (isStreamDirectUrl(url)) return url;
  try {
    const u = new URL(url);
    if (u.host === 'osmani-admin-api.onrender.com') {
      u.host = 'osmanitv.b-cdn.net';
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return url;
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
  if (isStreamDirectUrl(s)) {
    try {
      const token = new URL(s).searchParams.get('token');
      if (!token) return '';
      for (const part of token.split('.')) {
        try {
          let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
          while (b64.length % 4) b64 += '=';
          const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
          const upstream = String(payload.u ?? payload.url ?? '').trim();
          if (upstream) return upstream;
        } catch {
          /* next */
        }
      }
    } catch {
      return '';
    }
  }
  return s;
}

function isEmbed(url) {
  const inner = unwrapForEmbed(url);
  if (!inner || looksLikeHlsPath(inner)) return false;
  return /player\.php|\/player\/|\/embed(?:\/|$|\?)/i.test(inner);
}

function looksLikeHls(uri) {
  const s = String(uri ?? '').trim();
  if (!s) return false;
  if (isEmbed(s)) return false;
  if (looksLikeHlsPath(s)) return true;
  if (isStreamDirectUrl(s)) return true;
  if (isStreamProxyUrl(s) && looksLikeHlsPath(unwrapForEmbed(s))) return true;
  return false;
}

function pickRoute(url, pt) {
  const s = String(url ?? '').trim();
  if (!s) return 'embed-webview';
  if (pt === 'direct_hls') return 'native';
  if (isEmbed(s)) return 'embed-webview';
  if (looksLikeHls(s)) {
    if (pt === 'webview') return 'hls-webview';
    return 'native';
  }
  const lower = s.split(/[#?]/)[0].toLowerCase();
  if (/\.mp4$/i.test(lower) || /\.(?:m2ts|mts|ts)$/i.test(lower)) return 'native';
  return 'embed-webview';
}

const ycn =
  'http://het103b.ycn-redirect.com/live/918454578001/index.m3u8?t=abc&e=1';
const directRender =
  'https://osmani-admin-api.onrender.com/stream-direct?token=eyJ1IjoiaHR0cDovL2hl.dGVzdC5tM3U4In0=.sig';
const directCdn = directRender.replace('osmani-admin-api.onrender.com', 'osmanitv.b-cdn.net');
const mpingo = 'https://nur.mpingotv.com/v3/player.php?channel=1';

if (rewriteRenderToCdn(directRender) !== directRender) {
  fail('stream-direct must not CDN-rewrite');
} else pass('stream-direct stays on API host');

if (rewriteRenderToCdn(directCdn) !== directCdn) {
  fail('already-CDN stream-direct unchanged');
} else pass('CDN stream-direct unchanged');

const cases = [
  { name: 'Bein exo', url: directRender, pt: 'exo', want: 'native' },
  { name: 'Bein vlc', url: directRender, pt: 'vlc', want: 'native' },
  { name: 'Bein native', url: directRender, pt: 'native', want: 'native' },
  { name: 'Bein ijk', url: directRender, pt: 'ijk', want: 'native' },
  { name: 'Bein webview', url: directRender, pt: 'webview', want: 'hls-webview' },
  { name: 'Direct HLS okcdn', url: 'https://vsd272.okcdn.ru/hls/live/index.m3u8?p', pt: 'direct_hls', want: 'native' },
  { name: 'YCN raw exo', url: ycn, pt: 'exo', want: 'native' },
  { name: 'Mpingo webview', url: mpingo, pt: 'webview', want: 'embed-webview' },
  { name: 'Mpingo exo', url: mpingo, pt: 'exo', want: 'embed-webview' },
];

for (const c of cases) {
  const got = pickRoute(c.url, c.pt);
  if (got !== c.want) fail(`${c.name}: expected ${c.want}, got ${got}`);
  else pass(`${c.name} → ${got}`);
}

async function liveManifestProbe() {
  const res = await fetch('https://osmani-admin-api.onrender.com/api/channels');
  const bein = (await res.json()).find((c) => c.name === 'Bein 1 HD');
  if (!bein) {
    fail('live Bein missing');
    return;
  }
  const direct = String(bein.direct_stream_url ?? '').trim();
  const rewritten = rewriteRenderToCdn(direct);
  if (rewritten.includes('osmanitv.b-cdn.net/stream-direct')) {
    fail('live Bein direct_stream_url was CDN-rewritten');
  } else pass('live Bein direct_stream_url not CDN-rewritten');

  const mRes = await fetch(rewritten);
  const body = await mRes.text();
  console.log('\n--- live Bein stream-direct manifest ---');
  console.log('  url:', rewritten.slice(0, 100));
  console.log('  status:', mRes.status);
  console.log('  extm3u:', body.trimStart().startsWith('#EXTM3U'));
  if (!body.trimStart().startsWith('#EXTM3U')) {
    fail('live Bein stream-direct must return EXTM3U to Exo');
  } else pass('live Bein stream-direct returns EXTM3U');
}

async function main() {
  await liveManifestProbe();
  if (process.exitCode) process.exit(1);
  console.log('\n[verify-player-type-routes] ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
