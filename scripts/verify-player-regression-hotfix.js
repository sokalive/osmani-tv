#!/usr/bin/env node
'use strict';

/**
 * Ensures player hotfix restored pre-4e6f178 routing (native HLS + embed fallback).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');

function pass(label) {
  console.log('PASS:', label);
}

function fail(label, detail) {
  console.error('FAIL:', label, detail ?? '');
  process.exitCode = 1;
}

if (player.includes('function pickPlaybackRoute(')) pass('pickPlaybackRoute inline in ChannelPlayerScreen');
else fail('pickPlaybackRoute must be inline in ChannelPlayerScreen');

if (!fs.existsSync(path.join(root, 'lib/playbackRoute.js'))) {
  fail('lib/playbackRoute.js missing');
} else pass('playbackRoute.js present for verify scripts');

if (player.includes('pickOsmaniPlaybackRoute')) fail('broken pickOsmaniPlaybackRoute still referenced');
else pass('pickOsmaniPlaybackRoute removed');

if (!player.includes('const normalizedPlayerType = normalizePlayerType')) {
  fail('normalizedPlayerType must be defined');
} else pass('normalizedPlayerType defined');

if (!player.includes('useEmbedWebView')) fail('embed-webview path missing');
else pass('embed-webview path present');

if (!player.includes('useNativePlayer')) fail('native player path missing');
else pass('native player path present');

if (fs.existsSync(path.join(root, 'lib/playerPlaybackRoute.js'))) {
  fail('lib/playerPlaybackRoute.js should be deleted');
} else pass('playerPlaybackRoute.js removed');

if (process.exitCode) process.exit(1);
console.log('[verify-player-regression-hotfix] ok');
