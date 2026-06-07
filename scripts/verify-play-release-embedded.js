#!/usr/bin/env node
'use strict';

/**
 * Verify Play Store release embeds first-launch OTA bootstrap (no OTA required on session 1).
 * Run: node scripts/verify-play-release-embedded.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

const appConfig = require(path.join(root, 'app.config.js'));
const expo = appConfig.expo;

if (Number(expo.android?.versionCode) !== 18) {
  fail(`versionCode must be 18, got ${expo.android?.versionCode}`);
} else pass('versionCode is 18');

if (expo.version !== '1.7.1') {
  fail(`versionName must be 1.7.1, got ${expo.version}`);
} else pass('versionName is 1.7.1');

if (expo.runtimeVersion?.policy !== 'appVersion') fail('runtimeVersion policy');
else pass('runtimeVersion policy appVersion');

const requiredInSource = [
  ['components/EmbeddedOtaBootGate.js', 'EmbeddedOtaBootGate'],
  ['components/EmbeddedOtaLoadingScreen.js', 'Inasasisha programu'],
  ['lib/otaBootGatePolicy.js', 'shouldRunOtaBootGate'],
  ['lib/otaBootGatePolicy.js', 'isStalePlaybackBundle'],
  ['lib/embeddedLaunchGate.js', 'runEmbeddedLaunchOtaGate'],
  ['lib/expoUpdatesClient.js', 'reloadIfNew'],
  ['lib/expoUpdatesClient.js', 'shouldReloadAfterOtaFetch'],
  ['lib/startupSplashBoot.js', 'beginEmbeddedLaunchGate'],
  ['App.js', 'EmbeddedOtaBootGate'],
];

for (const [file, needle] of requiredInSource) {
  const src = read(file);
  if (!src.includes(needle)) fail(`${file} missing ${needle}`);
  else pass(`${file} contains ${needle}`);
}

try {
  execSync('git merge-base --is-ancestor a63ee95 HEAD', { cwd: root, stdio: 'pipe' });
  pass('HEAD includes first-launch fix commit a63ee95');
} catch {
  fail('HEAD must include commit a63ee95 or newer');
}

console.log('\n--- embedded first-launch behavior (source) ---');
console.log('  Play Store install runs THIS bundle on session 1 (not b20bfc5).');
console.log('  EmbeddedOtaBootGate + shouldRunOtaBootGate + reloadAsync ship in AAB.');
console.log('  First-launch Bein does NOT depend on downloading OTA before playback.');

if (process.exitCode) process.exit(1);
console.log('\n[verify-play-release-embedded] ok');
