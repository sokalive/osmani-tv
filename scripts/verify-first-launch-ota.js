#!/usr/bin/env node
'use strict';

/**
 * Fresh install: embedded launch must sync OTA before playback surfaces open.
 *
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

const splashBootSrc = read('lib/startupSplashBoot.js');
const gateSrc = read('lib/embeddedLaunchGate.js');
const splashSrc = read('hooks/useStartupSplash.js');
const appSrc = read('App.js');
const updatesSrc = read('lib/expoUpdatesClient.js');
const mediaSrc = read('lib/mediaDelivery.js');
const hlsSrc = read('lib/hlsPlayback.js');

if (!splashBootSrc.includes('beginEmbeddedLaunchGate')) {
  fail('startupSplashBoot must begin embedded gate at import time');
} else pass('embedded gate starts at import time');

if (!gateSrc.includes('beginEmbeddedLaunchGate')) {
  fail('embeddedLaunchGate module missing');
} else pass('embeddedLaunchGate module present');

if (!appSrc.includes('appBootReady')) {
  fail('App must block UI until embedded launch gate completes');
} else pass('App blocks UI until boot ready');

if (!appSrc.includes('awaitEmbeddedLaunchGate')) {
  fail('App must await embedded launch gate');
} else pass('App awaits embedded launch gate');

if (!splashSrc.includes('appBootReady')) {
  fail('useStartupSplash must hide splash only after appBootReady');
} else pass('splash hides after boot gate');

if (!updatesSrc.includes('Updates.reloadAsync()')) {
  fail('expoUpdatesClient must reload on embedded launch when OTA is new');
} else pass('embedded launch reloadAsync wired');

if (!updatesSrc.includes('embedded_force_reload')) {
  fail('embedded launch must force reload when update available');
} else pass('embedded force reload fallback present');

if (!mediaSrc.includes('repairStreamDirectApiHost')) {
  fail('repairStreamDirectApiHost safety net missing');
} else pass('stream-direct API host repair present');

if (!hlsSrc.includes('/stream-direct')) {
  fail('stream-direct must be recognized as HLS playback URI');
} else pass('stream-direct HLS playback detection present');

function repairStreamDirectApiHostMirror(input) {
  const s = String(input ?? '').trim();
  if (!s || !/\/stream-direct(?:\?|$)/i.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    if (host === 'osmani-admin-api.onrender.com') return s;
    if (host.includes('b-cdn.net')) {
      u.protocol = 'https:';
      u.host = 'osmani-admin-api.onrender.com';
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return s;
}

const cdnDirect = 'https://osmanitv.b-cdn.net/stream-direct?token=abc';
const repaired = repairStreamDirectApiHostMirror(cdnDirect);
if (!repaired.includes('osmani-admin-api.onrender.com/stream-direct')) {
  fail('CDN stream-direct must repair to API host');
} else pass('CDN stream-direct repairs to API host');

if (process.exitCode) process.exit(1);
console.log('[verify-first-launch-ota] ok');
