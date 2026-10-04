#!/usr/bin/env node
'use strict';

/**
 * Publish EXO HTTP→HTTPS stream-proxy bridge OTA (runtime 1.8.2 / versionCode 24).
 * Channels: preview, vps-preview, production — no new APK/AAB.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = '1.8.2';
const CHANNELS = ['preview', 'vps-preview', 'production'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const logPath = path.join(__dirname, '..', 'ota-publish-exo-playback-bridge.log');
const summaryPath = path.join(__dirname, '..', 'ota-publish-exo-playback-bridge-summary.json');

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {}
}

fs.writeFileSync(logPath, `[publish-exo-playback-bridge-ota] started ${new Date().toISOString()}\n`);
console.log('=== OTA SAFETY CHECK ===');
console.log(`Channels: ${CHANNELS.join(', ')}`);
console.log(`Runtime: ${RUNTIME}`);
console.log('versionCode: unchanged (24)');
console.log('APK/AAB: NONE\n');

const msg =
  'fix(playback): EXO prefers backend HTTPS stream-proxy playbackUrl for HTTP sources runtime 1.8.2';
const results = [];

for (const channel of CHANNELS) {
  const envFlag = channel === 'production' ? '--environment production' : '';
  const cmd =
    `${NPX} eas-cli update --channel ${channel} ${envFlag} `.replace(/\s+/g, ' ').trim() +
    ` --message "${msg.replace(/"/g, '')}" --non-interactive`;
  console.log(`\nPublishing ${channel}\n`);
  appendLog(`TARGET channel=${channel}`);
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
    console.error(`FAILED channel=${channel}`);
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
  channels: results,
  message: msg,
};
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log('\n=== OTA PUBLISH SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
