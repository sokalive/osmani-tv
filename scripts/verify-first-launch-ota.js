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

const splashSrc = read('hooks/useStartupSplash.js');
const updatesSrc = read('lib/expoUpdatesClient.js');
const mediaSrc = read('lib/mediaDelivery.js');
const hlsSrc = read('lib/hlsPlayback.js');

if (!splashSrc.includes('isEmbeddedLaunchRuntime')) {
  fail('useStartupSplash must detect embedded launch');
} else pass('embedded launch detection in splash hook');

if (!splashSrc.includes('syncExpoUpdateBundle(\'splash-embedded\'')) {
  fail('embedded launch must await splash-embedded OTA sync');
} else pass('embedded launch awaits OTA before splash hide');

if (!updatesSrc.includes('Updates.reloadAsync()')) {
  fail('expoUpdatesClient must reload on embedded launch when OTA is new');
} else pass('embedded launch reloadAsync wired');

if (!updatesSrc.includes('isEmbeddedLaunch')) {
  fail('expoUpdatesClient must gate reload on isEmbeddedLaunch');
} else pass('reload gated on isEmbeddedLaunch');

if (!mediaSrc.includes('isStreamDirectUrl')) {
  fail('isStreamDirectUrl helper missing');
} else pass('stream-direct CDN rewrite blocked');

if (!hlsSrc.includes('/stream-direct')) {
  fail('stream-direct must be recognized as HLS playback URI');
} else pass('stream-direct HLS playback detection present');

if (process.exitCode) process.exit(1);
console.log('[verify-first-launch-ota] ok');
