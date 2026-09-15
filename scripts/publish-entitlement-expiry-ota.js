#!/usr/bin/env node
'use strict';

/**
 * Publish full entitlement / expiry / sticky-playback contract OTA.
 * Targets all Version-24 compatible Osmani channels:
 *  - preview      — CDN / sideload / emulator (primary for this APK)
 *  - vps-preview  — EAS vps-preview builds
 *  - production   — Play Store / production
 *
 * Runtime 1.8.2 / versionCode 24 — NO new APK/AAB.
 *
 * Usage: node scripts/publish-entitlement-expiry-ota.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = '1.8.2';
const CHANNELS = ['preview', 'vps-preview', 'production'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const logPath = path.join(__dirname, '..', 'ota-publish-entitlement-expiry.log');
const summaryPath = path.join(__dirname, '..', 'ota-publish-entitlement-expiry-summary.json');

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {}
}

console.log('=== OTA SAFETY CHECK ===');
console.log(`Channels: ${CHANNELS.join(', ')}`);
console.log(`Runtime: ${RUNTIME}`);
console.log('versionCode: unchanged (24)');
console.log('APK/AAB: NONE');
console.log('Project: Osmani TV (adf835d4-ad5d-425d-9e5b-de9a803066e0)');
console.log('========================\n');

fs.writeFileSync(logPath, `[publish-entitlement-expiry-ota] started ${new Date().toISOString()}\n`);

const msg =
  'fix(entitlement): sticky revoke honor + cache expiresAt precedence + SSE grant fail-closed runtime 1.8.2';
const quotedMsg = msg.replace(/"/g, '');

const results = [];

for (const channel of CHANNELS) {
  const envFlag = channel === 'production' ? '--environment production' : '';
  const cmd =
    `${NPX} eas-cli update --channel ${channel} ${envFlag} `.replace(/\s+/g, ' ').trim() +
    ` --message "${quotedMsg}" --non-interactive`;

  console.log(`\nPublishing ${channel}: ${cmd}\n`);
  appendLog(`TARGET channel=${channel} runtime=${RUNTIME}`);

  const result = spawnSync(cmd, {
    stdio: 'pipe',
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      EAS_SKIP_AUTO_FINGERPRINT: '1',
      OTA_RUNTIME_TARGET: RUNTIME,
      EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
    },
  });

  const out = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(out);
  appendLog(out);

  if (result.status !== 0) {
    console.error(`FAILED channel=${channel} exit ${result.status}`);
    appendLog(`FAILED channel=${channel} exit ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const groupMatch =
    out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
    out.match(/group[=:\s]+([a-f0-9-]{36})/i);
  const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);

  results.push({
    channel,
    groupId: groupMatch ? groupMatch[1] : null,
    androidUpdateId: androidMatch ? androidMatch[1] : null,
    runtime: RUNTIME,
    ok: true,
  });
}

const summary = {
  publishedAt: new Date().toISOString(),
  runtime: RUNTIME,
  versionCode: 24,
  versionName: '1.8.2',
  platforms: ['android'],
  channels: results,
  message: msg,
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log('\n=== OTA PUBLISH SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${summaryPath}`);
