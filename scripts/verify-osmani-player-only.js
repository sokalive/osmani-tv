#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertContains(rel, needle, label) {
  if (!read(rel).includes(needle)) {
    console.error('FAIL:', label, rel, 'missing', needle);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

function assertNotContains(rel, needle, label) {
  if (read(rel).includes(needle)) {
    console.error('FAIL:', label, rel, 'still contains', needle);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

assertContains('lib/playerPlaybackRoute.js', 'osmani-hls', 'osmani-hls route');
assertContains('lib/playerPlaybackRoute.js', 'isStreamProxyUrl', 'proxy routes to osmani-hls');
assertNotContains('screens/ChannelPlayerScreen.js', 'embed-webview', 'no embed-webview route');
assertNotContains('screens/ChannelPlayerScreen.js', 'embedWebRef', 'no embed webview ref');
assertNotContains('screens/ChannelPlayerScreen.js', 'buildEmbedBridgeJs', 'no embed bridge import');
assertNotContains('screens/ChannelPlayerScreen.js', 'hls-webview', 'no legacy hls-webview route name');
assertContains('screens/ChannelPlayerScreen.js', 'useOsmaniHls', 'osmani hls engine flag');
assertContains('screens/ChannelPlayerScreen.js', 'buildHlsCmdScript', 'hls command bridge for Osmani controls');
assertContains('screens/ChannelPlayerScreen.js', 'useNativeControls={false}', 'native controls hidden');
assertContains('lib/hlsJsPlayerHtml.js', 'controlsList="nodownload nofullscreen noremoteplayback"', 'provider controls suppressed');
assertContains('lib/hlsJsPlayerHtml.js', 'pointer-events:none', 'video surface non-interactive');

if (process.exitCode) process.exit(1);
console.log('[verify-osmani-player-only] ok');
