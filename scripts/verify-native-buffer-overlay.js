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

if (!screen.includes('NATIVE_BUFFER_OVERLAY_DEBOUNCE_MS = 2000')) {
  fail('2000ms native buffer debounce constant');
} else pass('2000ms native buffer debounce constant');

if (!screen.includes("logPlayerBuffer('overlay_show'")) fail('overlay_show log');
else pass('overlay_show log');

if (!screen.includes("logPlayerBuffer('overlay_hide'")) fail('overlay_hide log');
else pass('overlay_hide log');

if (!screen.includes("logPlayerBuffer('buffer_start'")) fail('buffer_start log');
else pass('buffer_start log');

if (!screen.includes("logPlayerBuffer('buffer_end'")) fail('buffer_end log');
else pass('buffer_end log');

if (!screen.includes('showNativeBufferOverlay')) fail('showNativeBufferOverlay state');
else pass('showNativeBufferOverlay state');

if (!screen.includes('applyNativeBufferStatus')) fail('applyNativeBufferStatus helper');
else pass('applyNativeBufferStatus helper');

if (!screen.includes('useNativePlayer ? showNativeBufferOverlay : isBuffering')) {
  fail('render gates native vs webview overlay');
} else pass('render gates native vs webview overlay');

if (!screen.includes('nativePlaybackStartedRef')) fail('nativePlaybackStartedRef');
else pass('nativePlaybackStartedRef');

if (process.exitCode) process.exit(1);
console.log('[verify-native-buffer-overlay] ok');
