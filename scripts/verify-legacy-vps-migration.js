#!/usr/bin/env node
'use strict';

/**
 * Legacy Play APK VPS migration matrix (versionCode 15–24).
 * Run: node scripts/verify-legacy-vps-migration.js
 */

const fs = require('fs');
const path = require('path');

const VPS = 'https://api.osmanitv.com';
const RENDER = 'https://osmani-admin-api.onrender.com';
const PLAY_OTA_MIN = 16;

const MATRIX = [
  { versionCode: 15, runtime: 'v15', otaCapable: false },
  { versionCode: 16, runtime: '1.6.0', otaCapable: true },
  { versionCode: 17, runtime: '1.7.0', otaCapable: true },
  { versionCode: 18, runtime: '1.7.1', otaCapable: true },
  { versionCode: 19, runtime: '1.7.2', otaCapable: true },
  { versionCode: 20, runtime: '1.7.2', otaCapable: true },
  { versionCode: 21, runtime: '1.7.2', otaCapable: true },
  { versionCode: 22, runtime: '1.8.0', otaCapable: true },
  { versionCode: 23, runtime: '1.8.1', otaCapable: true },
  { versionCode: 24, runtime: '1.8.2', otaCapable: true },
];

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function simulateForcedVps(versionCode) {
  return versionCode >= PLAY_OTA_MIN ? VPS : null;
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

console.log('=== Static: legacy VPS migration code ===\n');

const playVps = read('lib/playVpsApiHost.js');
if (!playVps.includes('PLAY_OTA_MIN_VERSION_CODE = 16')) {
  fail('PLAY_OTA_MIN_VERSION_CODE must be 16');
} else {
  pass('PLAY_OTA_MIN_VERSION_CODE = 16');
}

if (!playVps.includes('vc >= PLAY_OTA_MIN_VERSION_CODE')) {
  fail('isPlayStoreVpsBuild must use PLAY_OTA_MIN_VERSION_CODE');
} else {
  pass('VPS force applies from versionCode 16+');
}

console.log('\n=== Host resolution matrix (after migration OTA) ===\n');
console.log('Version | OTA Capable | VPS Migrated (JS) | Render Remaining');
console.log('--------|-------------|-------------------|------------------');

for (const row of MATRIX) {
  const forced = simulateForcedVps(row.versionCode);
  const vpsMigrated = forced === VPS;
  const renderRemaining = !vpsMigrated;
  const ota = row.otaCapable ? 'YES' : 'NO';
  const migrated = vpsMigrated && row.otaCapable ? 'YES (after OTA)' : vpsMigrated ? 'YES (native)' : 'NO';
  const render = renderRemaining ? 'YES (embedded)' : 'NO';
  console.log(
    `${String(row.versionCode).padEnd(7)} | ${ota.padEnd(11)} | ${migrated.padEnd(17)} | ${render}`,
  );

  if (row.otaCapable && !vpsMigrated) fail(`vc ${row.versionCode} should force VPS after OTA`);
  if (!row.otaCapable && vpsMigrated) fail(`vc ${row.versionCode} must not force VPS without OTA path`);
}

console.log('\n=== Live VPS (Render OFF tolerance) ===\n');

(async () => {
  for (const ep of [
    `${VPS}/api/health`,
    `${VPS}/api/channels`,
    `${VPS}/api/payments/checkout-providers`,
  ]) {
    try {
      const res = await fetch(ep, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) fail(`${ep} HTTP ${res.status}`);
      else pass(`${ep} HTTP ${res.status}`);
    } catch (e) {
      fail(`${ep} ${e?.message ?? e}`);
    }
  }

  for (const vc of [19, 23]) {
    const qs = new URLSearchParams({
      platform: 'android',
      package: 'com.burudanitv.app',
      version_code: String(vc),
      version_name: '1.0.0',
    });
    const url = `${VPS}/api/update-check?${qs}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) fail(`update-check v${vc} HTTP ${res.status}`);
    else pass(`update-check v${vc} HTTP ${res.status} on VPS`);
  }

  if (!process.exitCode) {
    console.log('\n[verify-legacy-vps-migration] ok');
  }
})().catch((e) => {
  fail(e?.message ?? String(e));
});
