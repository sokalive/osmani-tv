#!/usr/bin/env node
'use strict';

/**
 * Mpingo Chrome player regression:
 * - Bein/YCN HLS routes unchanged
 * - Mpingo ClearKey (webview) → embed-webview
 * - Mpingo Widevine (chrome) → chrome-webview
 *
 * Run: node scripts/verify-mpingo-chrome-playback.js
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

const routeSrc = read('lib/playbackRoute.js');
const channelSrc = read('lib/channelStream.js');
const playerSrc = read('screens/ChannelPlayerScreen.js');

if (!channelSrc.includes("chrome: 'chrome'")) fail('normalizePlayerType must map chrome');
else pass('normalizePlayerType supports chrome');

if (!routeSrc.includes("'chrome-webview'")) fail('pickPlaybackRoute must define chrome-webview');
else pass('pickPlaybackRoute defines chrome-webview');

if (!routeSrc.includes("playerTypeNorm === 'chrome' ? 'chrome-webview'")) {
  fail('chrome route must be scoped to embed pages');
} else pass('chrome route scoped to embed pages only');

if (!playerSrc.includes('useChromeWebView')) fail('ChannelPlayerScreen must use chrome webview');
else pass('ChannelPlayerScreen chrome webview branch');

if (!playerSrc.includes('CHROME_WEBVIEW_PROPS')) fail('ChannelPlayerScreen must spread CHROME_WEBVIEW_PROPS');
else pass('ChannelPlayerScreen CHROME_WEBVIEW_PROPS');

if (playerSrc.includes('authorizedPackageName')) {
  fail('authorizedPackageName must not be reintroduced');
} else pass('no authorizedPackageName');

function looksLikeHlsPath(url) {
  return /\.m3u8(?:$|[?#&])/i.test(String(url ?? ''));
}

function isStreamDirectUrl(input) {
  return /\/stream-direct(?:\?|$)/i.test(String(input ?? ''));
}

function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ''));
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
  if (!s) return pt === 'chrome' ? 'chrome-webview' : 'embed-webview';
  if (isEmbed(s)) return pt === 'chrome' ? 'chrome-webview' : 'embed-webview';
  if (looksLikeHls(s)) {
    if (pt === 'webview') return 'hls-webview';
    return 'native';
  }
  const lower = s.split(/[#?]/)[0].toLowerCase();
  if (/\.mp4$/i.test(lower) || /\.(?:m2ts|mts|ts)$/i.test(lower)) return 'native';
  return 'embed-webview';
}

const ycn = 'http://het103b.ycn-redirect.com/live/918454578001/index.m3u8?t=abc&e=1';
const beinDirect =
  'https://osmani-admin-api.onrender.com/stream-direct?token=eyJ1IjoiaHR0cDovL2hl.dGVzdC5tM3U4In0=.sig';
const mpingoClear = 'https://nur.mpingotv.com/v3/player.php?channel=1';
const mpingoWidevine = 'https://nur.mpingotv.com/v3/player.php?channel=2';

const cases = [
  { name: 'Bein exo', url: beinDirect, pt: 'exo', want: 'native' },
  { name: 'Bein chrome (must stay native)', url: beinDirect, pt: 'chrome', want: 'native' },
  { name: 'YCN exo', url: ycn, pt: 'exo', want: 'native' },
  { name: 'YCN chrome (must stay native)', url: ycn, pt: 'chrome', want: 'native' },
  { name: 'Mpingo ClearKey webview', url: mpingoClear, pt: 'webview', want: 'embed-webview' },
  { name: 'Mpingo ClearKey exo fallback', url: mpingoClear, pt: 'exo', want: 'embed-webview' },
  { name: 'Mpingo Widevine chrome', url: mpingoWidevine, pt: 'chrome', want: 'chrome-webview' },
  { name: 'Mpingo Widevine webview stays embed', url: mpingoWidevine, pt: 'webview', want: 'embed-webview' },
];

for (const c of cases) {
  const got = pickRoute(c.url, c.pt);
  if (got !== c.want) fail(`${c.name}: expected ${c.want}, got ${got}`);
  else pass(`${c.name} → ${got}`);
}

async function liveApiCheck() {
  const res = await fetch('https://osmani-admin-api.onrender.com/api/channels');
  const channels = await res.json();
  const azam1 = channels.find((c) => c.name === 'Azam 1 HD');
  const azam2 = channels.find((c) => c.name === 'Azam TWO');
  if (!azam1 || !azam2) {
    fail('live API missing Azam 1 HD or Azam TWO');
    return;
  }
  if (azam1.playerType !== 'webview' || azam1.use_chrome_player !== false) {
    fail(`Azam 1 HD expected webview/false, got ${azam1.playerType}/${azam1.use_chrome_player}`);
  } else pass('live Azam 1 HD webview ClearKey profile');
  if (azam2.playerType !== 'chrome' || azam2.use_chrome_player !== true) {
    fail(`Azam TWO expected chrome/true, got ${azam2.playerType}/${azam2.use_chrome_player}`);
  } else pass('live Azam TWO chrome Widevine profile');

  const ch1Url = String(azam1.url ?? '').trim();
  const ch2Url = String(azam2.url ?? '').trim();
  const r1 = pickRoute(ch1Url, azam1.playerType);
  const r2 = pickRoute(ch2Url, azam2.playerType);
  if (r1 !== 'embed-webview') fail(`Azam 1 route ${r1}`);
  else pass('live Azam 1 → embed-webview');
  if (r2 !== 'chrome-webview') fail(`Azam TWO route ${r2}`);
  else pass('live Azam TWO → chrome-webview');
}

async function main() {
  await liveApiCheck();
  if (process.exitCode) process.exit(1);
  console.log('\n[verify-mpingo-chrome-playback] ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
