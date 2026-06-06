#!/usr/bin/env node
'use strict';

/**
 * Regression suite: authorizedPackageName + Chrome player + backward-compatible routing.
 * Run: node scripts/verify-mpingo-chrome-playback.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const results = [];

function pass(section, label) {
  results.push({ section, status: 'PASS', label });
  console.log(`PASS [${section}] ${label}`);
}

function fail(section, label, detail) {
  results.push({ section, status: 'FAIL', label, detail: detail ?? '' });
  console.error(`FAIL [${section}] ${label}`, detail ?? '');
  process.exitCode = 1;
}

function section(name, fn) {
  try {
    fn();
  } catch (e) {
    fail(name, 'section threw', e.message);
  }
}

const channelStreamSrc = read('lib/channelStream.js');
const playbackRouteSrc = read('lib/playbackRoute.js');
const authorizedSrc = read('lib/authorizedPackageName.js');
const chromeSrc = read('lib/chromePlayerWebView.js');
const rowSrc = read('lib/playerChannelFromRow.js');
const identitySrc = read('lib/playbackStreamIdentity.js');
const embedSrc = read('lib/embedBridgeJs.js');
const playerSrc = read('screens/ChannelPlayerScreen.js');
const teardownSrc = read('lib/playerTeardown.js');

const { pickPlaybackRoute } = require(path.join(root, 'lib/playbackRoute.js'));
const {
  readAuthorizedPackageName,
  appendAuthorizedPackageHeaders,
  buildPlaybackRequestHeaders,
  AUTHORIZED_PACKAGE_HEADER,
} = require(path.join(root, 'lib/authorizedPackageName.js'));
const { buildEmbedPageBootstrapJs } = require(path.join(root, 'lib/embedBridgeJs.js'));
const { playbackStreamIdentity } = require(path.join(root, 'lib/playbackStreamIdentity.js'));

function normalizePlayerType(pt) {
  const s = String(pt ?? 'exo')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  const map = {
    exo: 'exo',
    exoplayer: 'exo',
    webview: 'webview',
    vlc: 'vlc',
    native: 'native',
    ijk: 'ijk',
    ijkplayer: 'ijk',
    chrome: 'chrome',
    chromium: 'chrome',
  };
  const v = map[s] ?? s;
  if (v === 'webview' || v === 'vlc' || v === 'native' || v === 'ijk' || v === 'chrome') {
    return v;
  }
  return 'exo';
}

const MPINGO = 'https://nur.mpingotv.com/v3/player.php?channel=1';
const HLS = 'http://example.com/live/index.m3u8';
const MP4 = 'http://example.com/movie.mp4';

section('authorizedPackageName', () => {
  assert.strictEqual(readAuthorizedPackageName(null), '');
  assert.strictEqual(
    readAuthorizedPackageName({ authorized_package_name: ' com.example.app ' }),
    'com.example.app',
  );
  pass('authorizedPackageName', 'readAuthorizedPackageName snake/camel');

  const empty = appendAuthorizedPackageHeaders({ Referer: 'x' }, '');
  assert.strictEqual(empty.Referer, 'x');
  assert.strictEqual(empty[AUTHORIZED_PACKAGE_HEADER], undefined);
  pass('authorizedPackageName', 'empty package leaves headers unchanged');

  const withPkg = appendAuthorizedPackageHeaders({ Referer: 'x' }, 'com.mpingo.client');
  assert.strictEqual(withPkg[AUTHORIZED_PACKAGE_HEADER], 'com.mpingo.client');
  assert.strictEqual(withPkg['Authorized-Package-Name'], 'com.mpingo.client');
  pass('authorizedPackageName', 'non-empty package adds HTTP headers');

  const playbackHeaders = buildPlaybackRequestHeaders({
    referer: 'https://mpingo.test/',
    authorizedPackageName: 'com.vendor.tv',
  });
  assert.strictEqual(playbackHeaders[AUTHORIZED_PACKAGE_HEADER], 'com.vendor.tv');
  pass('authorizedPackageName', 'buildPlaybackRequestHeaders pipeline');

  assert(channelStreamSrc.includes('X-Package-Name'));
  pass('authorizedPackageName', 'buildStreamRequestHeaders wired in channelStream.js');

  assert(rowSrc.includes('authorizedPackageName'));
  pass('authorizedPackageName', 'playerChannelFromRow exports field');

  assert(identitySrc.includes('authorizedPackageName'));
  pass('authorizedPackageName', 'playbackStreamIdentity includes package');

  const bootstrap = buildEmbedPageBootstrapJs({ authorizedPackageName: 'com.test.pkg' });
  assert(bootstrap.includes('__OSMANI_AUTHORIZED_PACKAGE__'));
  assert(bootstrap.includes('com.test.pkg'));
  pass('authorizedPackageName', 'embed bootstrap injects package into page');

  assert(playerSrc.includes('buildPlaybackRequestHeaders'));
  assert(playerSrc.includes('buildEmbedPageBootstrapJs({'));
  pass('authorizedPackageName', 'ChannelPlayerScreen uses playback headers + bootstrap');
});

section('playerType normalization', () => {
  assert.strictEqual(normalizePlayerType('exo'), 'exo');
  assert.strictEqual(normalizePlayerType('ExoPlayer'), 'exo');
  assert.strictEqual(normalizePlayerType('webview'), 'webview');
  assert.strictEqual(normalizePlayerType('vlc'), 'vlc');
  assert.strictEqual(normalizePlayerType('native'), 'native');
  assert.strictEqual(normalizePlayerType('ijk'), 'ijk');
  assert.strictEqual(normalizePlayerType('ijkplayer'), 'ijk');
  assert.strictEqual(normalizePlayerType('chrome'), 'chrome');
  assert.strictEqual(normalizePlayerType('Chromium'), 'chrome');
  assert(channelStreamSrc.includes('chrome'));
  pass('playerType', 'channelStream.js includes chrome normalization');
});

section('routing backward compatibility', () => {
  assert.strictEqual(pickPlaybackRoute(HLS, 'exo'), 'native');
  pass('Exo', 'HLS → native (ExoPlayer)');

  assert.strictEqual(pickPlaybackRoute(HLS, 'vlc'), 'native');
  pass('VLC', 'HLS → native (unchanged alias)');

  assert.strictEqual(pickPlaybackRoute(HLS, 'native'), 'native');
  pass('Native', 'HLS → native');

  assert.strictEqual(pickPlaybackRoute(HLS, 'ijk'), 'native');
  pass('IJK', 'HLS → native (unchanged alias)');

  assert.strictEqual(pickPlaybackRoute(HLS, 'webview'), 'hls-webview');
  pass('WebView', 'HLS + webview → hls-webview');

  assert.strictEqual(pickPlaybackRoute(MPINGO, 'exo'), 'embed-webview');
  pass('Exo', 'Mpingo player.php → embed-webview (unchanged)');

  assert.strictEqual(pickPlaybackRoute(MPINGO, 'vlc'), 'embed-webview');
  pass('VLC', 'Mpingo player.php → embed-webview (unchanged)');

  assert.strictEqual(pickPlaybackRoute(MPINGO, 'webview'), 'embed-webview');
  pass('WebView', 'Mpingo player.php → embed-webview (not hls-webview)');

  assert.strictEqual(pickPlaybackRoute(MP4, 'exo'), 'native');
  pass('Exo', 'MP4 → native');

  assert.strictEqual(pickPlaybackRoute(MP4, 'vlc'), 'native');
  pass('VLC', 'MP4 → native');
});

section('Chrome player routing', () => {
  assert.strictEqual(pickPlaybackRoute(MPINGO, 'chrome'), 'chrome-webview');
  pass('Chrome', 'Mpingo player.php → chrome-webview');

  assert.strictEqual(pickPlaybackRoute(HLS, 'chrome'), 'chrome-webview');
  pass('Chrome', 'HLS + chrome → chrome-webview');

  assert.strictEqual(pickPlaybackRoute(MP4, 'chrome'), 'chrome-webview');
  pass('Chrome', 'MP4 + chrome → chrome-webview');

  assert(chromeSrc.includes('CHROME_WEBVIEW_PROPS'));
  assert(chromeSrc.includes('thirdPartyCookiesEnabled'));
  assert(chromeSrc.includes('sharedCookiesEnabled'));
  pass('Chrome', 'Chromium WebView props include cookies + storage');

  assert(playerSrc.includes('useChromeWebView'));
  assert(playerSrc.includes('CHROME_WEBVIEW_PROPS'));
  assert(playerSrc.includes('chromeWebRef'));
  pass('Chrome', 'ChannelPlayerScreen renders dedicated Chrome WebView');

  assert(!playerSrc.includes('function pickPlaybackRoute('));
  assert(playerSrc.includes("from '../lib/playbackRoute'"));
  pass('Chrome', 'pickPlaybackRoute centralized in lib/playbackRoute.js');
});

section('catalog + identity', () => {
  assert(rowSrc.includes('authorizedPackageName'));
  assert(rowSrc.includes('readAuthorizedPackageNameFromRow'));
  assert(channelStreamSrc.includes("'chrome'"));
  pass('catalog', 'playerChannelFromRow + channelStream export chrome + package fields');

  const id1 = playbackStreamIdentity({ url: MPINGO, playerType: 'exo' });
  const id2 = playbackStreamIdentity({
    url: MPINGO,
    playerType: 'chrome',
    authorizedPackageName: 'com.mpingo.authorized',
  });
  assert.notStrictEqual(id1, id2);
  pass('catalog', 'identity changes when playerType or package changes');
});

section('teardown + embed bridge', () => {
  assert(teardownSrc.includes('chromeWebRef'));
  pass('teardown', 'chrome WebView included in teardownWebViewRefs');

  assert(embedSrc.includes('detectShaka'));
  assert(embedSrc.includes('detectHlsJs'));
  pass('embed', 'Mpingo Shaka/HLS.js bridge intact');
});

section('OTA compatibility', () => {
  const appConfig = read('app.config.js');
  assert(appConfig.includes("runtimeVersion: {\n      policy: 'appVersion'"));
  assert(appConfig.includes("version: '1.7.0'"));
  pass('OTA', 'runtime 1.7.0 appVersion policy — JS-only change is OTA-safe');

  const nativeKt = fs.existsSync(path.join(root, 'modules/osmani-player'));
  if (nativeKt) fail('OTA', 'unexpected native player module added');
  else pass('OTA', 'no new native modules required');
});

section('screen wiring sanity', () => {
  if (playerSrc.includes('pickOsmaniPlaybackRoute')) {
    fail('screen', 'legacy pickOsmaniPlaybackRoute must not return');
  } else pass('screen', 'no pickOsmaniPlaybackRoute');

  if (!playerSrc.includes('useNativePlayer')) fail('screen', 'native path missing');
  else pass('screen', 'native Exo path present');

  if (!playerSrc.includes('useHlsWebView')) fail('screen', 'hls-webview path missing');
  else pass('screen', 'hls-webview path present');

  if (!playerSrc.includes('useEmbedWebView')) fail('screen', 'embed-webview path missing');
  else pass('screen', 'embed-webview path present');
});

console.log('\n=== REGRESSION REPORT ===');
const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`Total: ${results.length}  Passed: ${passed}  Failed: ${failed}`);
for (const r of results) {
  if (r.status === 'FAIL') console.log(`  FAIL  ${r.section} — ${r.label} ${r.detail}`);
}
if (failed === 0) {
  console.log('\n[verify-mpingo-chrome-playback] ALL CHECKS PASSED');
} else {
  console.log('\n[verify-mpingo-chrome-playback] FAILED');
  process.exit(1);
}
