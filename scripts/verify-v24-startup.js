#!/usr/bin/env node
'use strict';

/**
 * v24 / runtime 1.8.2 startup regression guards.
 * Run: node scripts/verify-v24-startup.js
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

const app = read('App.js');
const policy = read('lib/otaBootGatePolicy.js');
const splash = read('hooks/useStartupSplash.js');
const vps = read('lib/playVpsApiHost.js');

if (!vps.includes('isNativeVpsPlayRelease')) fail('native VPS release helper');
else pass('isNativeVpsPlayRelease');

if (!policy.includes('isNativeVpsPlayRelease()')) fail('OTA gate skips native VPS release');
else pass('OTA gate skips vc23+ native VPS');

if (app.includes('navReady') || app.includes('startupShellOverlay')) {
  fail('App must not gate Home on navReady overlay');
} else pass('no navReady splash overlay');

if (app.includes('hideStartupSplashWhenReady(')) {
  fail('App must not tie splash to onReady');
} else pass('splash not tied to onReady in App');

if (!splash.includes('requestAnimationFrame')) fail('splash hides on first paint rAF');
else pass('splash hides on first paint');

if (!splash.includes('STARTUP_SPLASH_MAX_MS')) fail('splash max timeout');
else pass('splash max timeout backup');

if (!process.exitCode) {
  console.log('\n[verify-v24-startup] ok');
}
