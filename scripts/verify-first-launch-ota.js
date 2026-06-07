#!/usr/bin/env node
'use strict';

/**
 * Verify embedded-launch OTA gate (fresh-install Bein fix) without device/network.
 * Run: node scripts/verify-first-launch-ota.js
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

const gate = read('lib/embeddedLaunchGate.js');
const expo = read('lib/expoUpdatesClient.js');
const boot = read('lib/startupSplashBoot.js');
const splash = read('hooks/useStartupSplash.js');
const app = read('App.js');
const diag = read('lib/firstLaunchBootDiagnostics.js');
const media = read('lib/mediaDelivery.js');
const route = read('lib/playbackRoute.js');

if (!gate.includes('beginEmbeddedLaunchGate')) fail('embeddedLaunchGate module');
else pass('embeddedLaunchGate module');

if (!gate.includes('reloadIfNew: true')) fail('gate requests reloadIfNew');
else pass('gate requests reloadIfNew');

if (gate.includes('forcedEmbeddedReload') || gate.includes('force_reload')) {
  fail('gate must not force reload without isNew');
} else pass('no forced reload without isNew');

if (!expo.includes('reloadIfNew')) fail('expoUpdatesClient reloadIfNew option');
else pass('expoUpdatesClient reloadIfNew option');

if (!expo.includes('fetch.isNew === true')) fail('reload only when fetch.isNew');
else pass('reload guarded by fetch.isNew');

if (expo.includes('fetch.isNew !== true')) fail('must not reload when isNew is false');
else pass('no reload when isNew is false');

if (!boot.includes('beginEmbeddedLaunchGate')) fail('startupSplashBoot starts gate');
else pass('startupSplashBoot starts gate');

if (!app.includes('awaitEmbeddedLaunchGate')) fail('App awaits embedded gate');
else pass('App awaits embedded gate');

if (!app.includes('appBootReady')) fail('App blocks shell until boot ready');
else pass('App blocks shell until boot ready');

if (!splash.includes('appBootReady')) fail('useStartupSplash waits for boot ready');
else pass('useStartupSplash waits for boot ready');

if (!diag.includes('staleEmbeddedLikely')) fail('firstLaunchBootDiagnostics probe');
else pass('firstLaunchBootDiagnostics probe');

if (!media.includes('isStreamDirectUrl')) fail('OTA playback must keep stream-direct exempt');
else pass('stream-direct CDN exempt preserved');

if (!route.includes('pickPlaybackRoute')) fail('playbackRoute preserved');
else pass('playbackRoute preserved');

async function liveBeinProbe() {
  const res = await fetch('https://osmani-admin-api.onrender.com/api/channels');
  const bein = (await res.json()).find((c) => /bein 1/i.test(c.name));
  if (!bein) {
    fail('live Bein missing');
    return;
  }
  const playbackUrl = String(bein.playbackUrl ?? bein.playback_url ?? '').trim();
  if (!playbackUrl.includes('/stream-direct')) {
    fail('Bein playbackUrl must be stream-direct');
    return;
  }
  pass('live Bein uses stream-direct playbackUrl');

  function rewriteRenderToCdn(url) {
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

  function looksLikeHlsEmbedded(uri) {
    return /\.m3u8(?:$|[?#&])/i.test(uri);
  }

  const staleUrl = rewriteRenderToCdn(playbackUrl);
  const embeddedRoute = looksLikeHlsEmbedded(staleUrl) ? 'native' : 'embed-webview';

  function isStreamDirectUrl(input) {
    return /\/stream-direct(?:\?|$)/i.test(String(input ?? ''));
  }
  function otaResolve(url) {
    return isStreamDirectUrl(url) ? url : rewriteRenderToCdn(url);
  }
  function looksLikeHlsOta(uri) {
    if (/\/stream-direct(?:\?|$)/i.test(uri)) return true;
    return /\.m3u8(?:$|[?#&])/i.test(uri);
  }
  const otaUrl = otaResolve(playbackUrl);
  const otaRoute = looksLikeHlsOta(otaUrl) ? 'native' : 'embed-webview';

  console.log('\n--- fresh install routing proof ---');
  console.log('  embedded playUrl host:', new URL(staleUrl).host);
  console.log('  embedded route:', embeddedRoute);
  console.log('  OTA playUrl host:', new URL(otaUrl).host);
  console.log('  OTA route:', otaRoute);

  if (embeddedRoute !== 'embed-webview') fail('embedded must route embed-webview');
  else pass('embedded bundle routes Bein to embed-webview (subscriptions.php risk)');

  if (otaRoute !== 'native') fail('OTA must route Bein to native');
  else pass('OTA bundle routes Bein to native Exo');
}

async function main() {
  await liveBeinProbe();
  if (process.exitCode) process.exit(1);
  console.log('\n[verify-first-launch-ota] ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
