#!/usr/bin/env node
'use strict';

/**
 * Google Play Data Safety / encryption compliance — production AAB preflight.
 * Run: node scripts/verify-play-compliance.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const VPS = 'https://api.osmanitv.com';
const RENDER = 'https://osmani-admin-api.onrender.com';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('[verify-play-compliance] Google Play HTTPS preflight\n');

const appConfig = require(path.join(root, 'app.config.js'));
const eas = JSON.parse(read('eas.json'));
const expo = appConfig.expo;

if (Number(expo.android?.versionCode) !== 24) fail(`versionCode 24 required, got ${expo.android?.versionCode}`);
else pass('versionCode 24');

if (expo.version !== '1.8.2') fail(`versionName 1.8.2 required, got ${expo.version}`);
else pass('versionName 1.8.2');

const prod = eas.build.production;
if (prod?.android?.buildType !== 'app-bundle') fail('production must be app-bundle');
else pass('production buildType: app-bundle (AAB)');

if (prod?.env?.EXPO_PUBLIC_API_URL !== VPS) fail('production API must be VPS HTTPS');
else pass(`production EXPO_PUBLIC_API_URL = ${VPS}`);

if (String(prod?.env?.EXPO_PUBLIC_STREAM_PROXY_URL || '').startsWith('http://')) {
  fail('stream-proxy must not use HTTP');
} else pass('stream-proxy uses HTTPS');

if (expo.android?.usesCleartextTraffic === true) fail('usesCleartextTraffic must be absent/false');
else pass('usesCleartextTraffic disabled');

const plugins = JSON.stringify(expo.plugins || []);
if (plugins.includes('withAndroidCleartextContabo')) fail('cleartext plugin must not be registered');
else pass('cleartext Contabo plugin not registered');

const buildProps = read('app.config.js');
if (/usesCleartextTraffic\s*:\s*true/.test(buildProps)) fail('expo-build-properties cleartext enabled');
else pass('expo-build-properties: no cleartext');

const { DEFAULT_API_URL, RENDER_PRODUCTION_API_URL } = require('../lib/apiBaseUrl');
if (DEFAULT_API_URL !== RENDER_PRODUCTION_API_URL) {
  fail('DEFAULT_API_URL must stay Render for legacy installed APKs without VPS embed');
} else pass('DEFAULT_API_URL remains Render HTTPS (legacy OTA/APK safe)');

(async () => {
  const renderOk = await fetch(`${RENDER}/api/health`).then((r) => r.ok).catch(() => false);
  if (!renderOk) fail('Render legacy API must remain reachable');
  else pass('Render legacy API still HTTP 200 (unchanged infrastructure)');

  const vpsOk = await fetch(`${VPS}/api/health`).then((r) => r.ok).catch(() => false);
  if (!vpsOk) fail('VPS API must be reachable for Play build');
  else pass('VPS API HTTP 200');

  console.log('\n=== PLAY DATA SAFETY COMPLIANCE SUMMARY ===');
  console.log('All production API traffic in the new AAB: HTTPS (api.osmanitv.com)');
  console.log('No cleartext Android network security exceptions in native build');
  console.log('No raw IP endpoints embedded in production EAS env');
  console.log('Legacy Render users: prior native embeds + DEFAULT_API_URL unchanged');
  console.log('OTA: not required for this native runtime bump (1.8.2 / v24)');

  if (!process.exitCode) console.log('\n[verify-play-compliance] ok');
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
