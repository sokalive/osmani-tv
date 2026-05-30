#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const screen = fs.readFileSync(
  path.join(__dirname, '..', 'screens/ChannelPlayerScreen.js'),
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

if (!screen.includes('playbackUrlsSignature')) {
  fail('playbackUrlsSignature helper for skip redundant remounts');
} else pass('playbackUrlsSignature helper');

if (!screen.includes('manifest_catalog_skip_remount')) {
  fail('catalog refresh skips remount when URLs unchanged');
} else pass('catalog refresh skips remount when URLs unchanged');

if (!screen.includes("logPlayerInterrupt('channel_change_remount'")) {
  fail('channel change interrupt logging');
} else pass('channel change interrupt logging');

if (!screen.includes("logPlayerInterrupt('proxy_fallback_remount'")) {
  fail('proxy fallback interrupt logging');
} else pass('proxy fallback interrupt logging');

if (process.exitCode) process.exit(1);
console.log('[verify-native-exo-playback] ok');
