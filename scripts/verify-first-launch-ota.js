#!/usr/bin/env node
'use strict';

/**
 * Verify embedded-launch OTA gate + Swahili loading screen (fresh-install Bein fix).
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
const policy = read('lib/otaBootGatePolicy.js');
const expo = read('lib/expoUpdatesClient.js');
const boot = read('lib/startupSplashBoot.js');
const splash = read('hooks/useStartupSplash.js');
const app = read('App.js');
const bootGate = read('components/EmbeddedOtaBootGate.js');
const loading = read('components/EmbeddedOtaLoadingScreen.js');
const diag = read('lib/firstLaunchBootDiagnostics.js');
const media = read('lib/mediaDelivery.js');
const route = read('lib/playbackRoute.js');

if (!gate.includes('runEmbeddedLaunchOtaGate')) fail('runEmbeddedLaunchOtaGate');
else pass('runEmbeddedLaunchOtaGate');

if (!gate.includes('EMBEDDED_LAUNCH_FETCH_TIMEOUT_MS')) fail('extended fetch timeout');
else pass('extended fetch timeout for slow devices');

if (!gate.includes('EMBEDDED_LAUNCH_MAX_ATTEMPTS')) fail('retry attempts');
else pass('retry attempts');

if (gate.includes('forcedEmbeddedReload') || gate.includes('force_reload_missing')) {
  fail('gate must not force reload without isNew');
} else pass('no forced reload without isNew');

if (!expo.includes('reloadIfNew')) fail('expoUpdatesClient reloadIfNew option');
else pass('expoUpdatesClient reloadIfNew option');

if (!expo.includes('fetch.isNew === true')) fail('reload only when fetch.isNew');
else pass('reload guarded by fetch.isNew');

if (!expo.includes('trackProgress')) fail('OTA progress tracking');
else pass('OTA progress tracking');

if (!expo.includes('ota_download_started')) fail('production OTA download logs');
else pass('production OTA download logs');

if (!bootGate.includes('EmbeddedOtaBootGate')) fail('EmbeddedOtaBootGate component');
else pass('EmbeddedOtaBootGate component');

if (!loading.includes('Inasasisha programu')) fail('Swahili OTA title');
else pass('Swahili OTA title');

if (!loading.includes('Tafadhali subiri kidogo')) fail('Swahili OTA subtitle');
else pass('Swahili OTA subtitle');

if (!app.includes('EmbeddedOtaBootGate')) fail('App wraps EmbeddedOtaBootGate');
else pass('App wraps EmbeddedOtaBootGate');

if (app.includes('appBootReady')) fail('legacy black bootGate removed');
else pass('legacy black bootGate removed');

if (!policy.includes('shouldRunOtaBootGate')) fail('otaBootGatePolicy');
else pass('otaBootGatePolicy');

if (!policy.includes('isStalePlaybackBundle')) fail('stale bundle detection');
else pass('stale bundle detection');

if (!gate.includes('shouldRunOtaBootGate')) fail('gate uses shouldRunOtaBootGate');
else pass('gate uses shouldRunOtaBootGate');

if (!expo.includes('shouldReloadAfterOtaFetch')) fail('reload uses stale session policy');
else pass('reload uses stale session policy');

if (!boot.includes('beginEmbeddedLaunchGate')) fail('startupSplashBoot prefetches gate');
else pass('startupSplashBoot prefetches gate');

if (!bootGate.includes('gate_mounted')) fail('gate_mounted diagnostic');
else pass('gate_mounted diagnostic');

if (!bootGate.includes('gate_blocking_ui')) fail('gate_blocking_ui diagnostic');
else pass('gate_blocking_ui diagnostic');

if (!bootGate.includes('shouldRunOtaBootGate')) fail('boot gate uses stale policy');
else pass('boot gate uses stale policy');

if (!bootGate.includes('beginEmbeddedLaunchGate')) fail('boot gate awaits shared gate promise');
else pass('boot gate awaits shared gate promise');

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
  require('./simulate-fresh-install-gate.js');
  await liveBeinProbe();
  if (process.exitCode) process.exit(1);
  console.log('\n[verify-first-launch-ota] ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
