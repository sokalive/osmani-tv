#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const screen = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');
const teardown = fs.readFileSync(path.join(root, 'lib/playerTeardown.js'), 'utf8');
const trial = fs.readFileSync(path.join(root, 'hooks/useTrialWatchSession.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');

function pass(msg) {
  console.log('PASS:', msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

if (!teardown.includes('teardownPlayback')) fail('teardownPlayback helper');
else pass('teardownPlayback helper');

if (!teardown.includes('teardownNativeVideo')) fail('teardownNativeVideo');
else pass('teardownNativeVideo');

if (!teardown.includes('teardownWebViewRefs')) fail('teardownWebViewRefs');
else pass('teardownWebViewRefs');

if (!teardown.includes('resetPlayerChrome')) fail('resetPlayerChrome');
else pass('resetPlayerChrome');

if (!screen.includes("from '../lib/playerTeardown'")) fail('ChannelPlayer imports teardown');
else pass('ChannelPlayer imports teardown');

if (!screen.includes("addListener('beforeRemove'")) fail('beforeRemove listener missing');
else pass('beforeRemove listener');

if (!screen.includes('exitPlayer')) fail('exitPlayer helper missing');
else pass('exitPlayer helper');

if (!screen.includes('playbackSurfacesMounted')) fail('playbackSurfacesMounted gate missing');
else pass('playbackSurfacesMounted gate');

if (!screen.includes('playerShellHidden')) fail('playerShellHidden shell gate missing');
else pass('playerShellHidden shell gate');

if (!screen.includes('rootHidden')) fail('rootHidden transparent shell missing');
else pass('rootHidden transparent shell');

if (!screen.includes('hideShell: false')) fail('security teardown preserves shell');
else pass('security teardown preserves shell');

if (!screen.includes('playerLifecycleRef')) fail('playerLifecycleRef missing');
else pass('playerLifecycleRef for trial guard');

if (!trial.includes('lifecycleRef')) fail('trial hook lifecycleRef guard');
else pass('trial hook lifecycleRef guard');

if (!trial.includes('isPlayerScreenActive')) fail('trial isPlayerScreenActive guard');
else pass('trial isPlayerScreenActive guard');

if (!app.includes("Platform.OS === 'android' ? 'slide_from_right'")) {
  fail('Android slide transition for ChannelPlayer');
} else pass('Android slide transition');

if (process.exitCode) process.exit(1);
console.log('[verify-player-teardown] ok');
