#!/usr/bin/env node
'use strict';

/**
 * Verify native Exo/expo-av Fill button wiring.
 * Run: node scripts/verify-native-fill.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const screen = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'lib/nativeVideoResize.js'), 'utf8');

function pass(msg) {
  console.log('PASS:', msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

if (!helper.includes('applyNativeVideoResizeMode')) fail('native resize helper missing');
else pass('applyNativeVideoResizeMode helper');

if (!helper.includes('ScaleAspectFill')) fail('native ScaleAspectFill mapping missing');
else pass('Exo ScaleAspectFill mapping');

if (!screen.includes('useNativePlayer')) fail('useNativePlayer guard missing');
else pass('useNativePlayer referenced');

if (!screen.includes('applyNativeVideoResizeMode(videoRef')) {
  fail('Fill must call applyNativeVideoResizeMode for native player');
} else pass('native fill applies setNativeProps');

if (!screen.includes('onReadyForDisplay={onNativeReadyForDisplay}')) {
  fail('native onReadyForDisplay resize hook missing');
} else pass('resize applied on ready for display');

if (!screen.includes('ResizeMode.COVER') || !screen.includes('ResizeMode.CONTAIN')) {
  fail('ResizeMode enum not used');
} else pass('ResizeMode enum used');

if (screen.match(/useNativePlayer[\s\S]{0,1200}setResizeMode[\s\S]{0,800}useHlsWebView/)) {
  pass('Fill handler branches native before webview');
} else if (screen.includes('if (useNativePlayer)')) {
  pass('Fill handler has native branch');
} else {
  fail('Fill handler missing native branch');
}

if (process.exitCode) process.exit(1);
console.log('[verify-native-fill] ok');
