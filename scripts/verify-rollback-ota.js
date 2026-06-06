#!/usr/bin/env node
'use strict';

/**
 * Documents production rollback OTA 44b88169 (commit 1959260).
 * Devices confirm receipt via Updates.updateId in getExpoUpdatesDiagnostics().
 *
 * Run: node scripts/verify-rollback-ota.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROLLBACK_GROUP_ID = '44b88169-4148-44e5-91b2-8c808630a782';
const ROLLBACK_COMMIT = '1959260';
const STABLE_PLAYBACK_BASELINE = 'e196fff';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const updatesClient = fs.readFileSync(
  path.join(__dirname, '..', 'lib/expoUpdatesClient.js'),
  'utf8',
);

if (!updatesClient.includes('updateId')) fail('expoUpdatesClient exposes updateId');
else pass('expoUpdatesClient exposes updateId for device verification');

const player = fs.readFileSync(
  path.join(__dirname, '..', 'screens/ChannelPlayerScreen.js'),
  'utf8',
);
if (!player.includes('CHROME_WEBVIEW_PROPS')) {
  fail('ChannelPlayerScreen must include Mpingo Chrome WebView props');
} else pass('Mpingo Chrome WebView props present in player screen');

if (player.includes('authorizedPackageName')) {
  fail('authorizedPackageName must not be present');
} else pass('no authorizedPackageName in player screen');

if (player.includes('overrideFileExtensionAndroid: \'m3u8\'')) {
  pass('native HLS uses m3u8 extension hint (e196fff-style Exo source)');
}

console.log('\n--- rollback OTA reference ---');
console.log('  production group ID:', ROLLBACK_GROUP_ID);
console.log('  git commit prefix:  ', ROLLBACK_COMMIT);
console.log('  stable baseline:    ', STABLE_PLAYBACK_BASELINE);
console.log('  current HEAD:       ', head);
console.log('\nDevice check (logcat / Metro):');
console.log('  getExpoUpdatesDiagnostics().updateId should match EAS group after OTA sync');

if (process.exitCode) process.exit(1);
console.log('\n[verify-rollback-ota] ok');
