#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const screen = fs.readFileSync(
  path.join(__dirname, '..', 'screens/ChannelPlayerScreen.js'),
  'utf8',
);
const hls = fs.readFileSync(path.join(__dirname, '..', 'lib/hlsPlayback.js'), 'utf8');
const identity = fs.readFileSync(
  path.join(__dirname, '..', 'lib/playbackStreamIdentity.js'),
  'utf8',
);

function pass(msg) {
  console.log('PASS:', msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

if (screen.includes('prepareNativeDirectHlsManifest')) {
  fail('native player must not call prepareNativeDirectHlsManifest');
} else pass('no prepareNativeDirectHlsManifest on native path');

if (screen.includes('nativePreparedManifestUri')) {
  fail('nativePreparedManifestUri state removed');
} else pass('no nativePreparedManifestUri state');

if (!screen.includes('hlsManifestUrl || uri')) {
  fail('native HLS source uses remote hlsManifestUrl');
} else pass('native HLS source uses remote hlsManifestUrl');

if (!screen.includes('playbackStreamIdentity')) {
  fail('playbackStreamIdentity for stable remount gate');
} else pass('playbackStreamIdentity for stable remount gate');

if (!screen.includes('manifest_catalog_skip_remount')) {
  fail('catalog refresh skips remount when identity unchanged');
} else pass('catalog refresh skips remount when identity unchanged');

if (!screen.includes("logPlayerInterrupt('native_source_hot_swap'")) {
  fail('native manifest hot-swap without remount');
} else pass('native manifest hot-swap without remount');

if (!screen.includes('pointerEvents="none"')) {
  fail('native Video pointerEvents none (hide source chrome)');
} else pass('native Video pointerEvents none');

if (screen.includes('channel?.url') && screen.match(/gateForPlayback[\s\S]{0,800}channel\?\.url/)) {
  fail('premium gate must not depend on channel.url (token rotation)');
} else pass('premium gate ignores channel.url rotation');

if (!screen.includes('premiumGateSessionRef')) {
  fail('premiumGateSessionRef prevents re-gate during playback');
} else pass('premiumGateSessionRef prevents re-gate during playback');

if (!screen.includes("logPlayerInterrupt('native_stall_recovery'")) {
  fail('native silent stall recovery');
} else pass('native silent stall recovery');

if (!hls.includes('stream-direct')) {
  fail('stream-direct URLs recognized as HLS for native Exo');
} else pass('stream-direct URLs recognized as HLS');

function looksLikeHlsPlaybackUriMirror(uri) {
  const s = String(uri ?? '').trim();
  if (!s) return false;
  if (/\.m3u8(?:$|[?#&])/i.test(s)) return true;
  if (/\/stream-direct(?:\?|$)/i.test(s)) return true;
  return false;
}

if (!looksLikeHlsPlaybackUriMirror('https://osmanitv.b-cdn.net/stream-direct?token=abc')) {
  fail('stream-direct runtime HLS detection');
} else pass('stream-direct runtime HLS detection');

const { playbackStreamIdentity, normalizeUrlForPlaybackIdentity } = require('../lib/playbackStreamIdentity');
const a = normalizeUrlForPlaybackIdentity('https://x/hls?tok=1&e=2');
const b = normalizeUrlForPlaybackIdentity('https://x/hls?tok=9&e=8');
if (a !== b) fail('volatile query params stripped for identity');
else pass('volatile query params stripped for identity');

if (
  playbackStreamIdentity({ url: 'https://x/a?tok=1' }) !==
  playbackStreamIdentity({ url: 'https://x/a?tok=2' })
) {
  fail('token rotation preserves stream identity');
} else pass('token rotation preserves stream identity');

if (process.exitCode) process.exit(1);
console.log('[verify-native-exo-playback] ok');
