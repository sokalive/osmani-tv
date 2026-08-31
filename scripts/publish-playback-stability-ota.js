#!/usr/bin/env node
'use strict';

/**
 * Publish playback stability fix OTA — production runtime 1.8.2 ONLY.
 * Usage: node scripts/publish-playback-stability-ota.js
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = '1.8.2';
const CHANNEL = 'production';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const logPath = path.join(__dirname, '..', 'ota-publish-playback-stability.log');

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {}
}

console.log('=== OTA SAFETY CHECK ===');
console.log(`Channel: ${CHANNEL}`);
console.log(`Runtime: ${RUNTIME}`);
console.log('Other runtimes: NONE (1.8.2 only)');
console.log('========================\n');

fs.writeFileSync(logPath, `[publish-playback-stability-ota] started ${new Date().toISOString()}\n`);
appendLog(`TARGET channel=${CHANNEL} runtime=${RUNTIME}`);

const msg =
  'fix(playback): preserve entitlement during transient verification failures runtime 1.8.2';
const quotedMsg = msg.replace(/"/g, '');
const cmd =
  `${NPX} eas-cli update --channel ${CHANNEL} --environment production ` +
  `--message "${quotedMsg}" --non-interactive`;

console.log(`Publishing: ${cmd}\n`);

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
  console.error(`FAILED exit ${result.status}`);
  appendLog(`FAILED exit ${result.status}`);
  process.exit(result.status ?? 1);
}

const groupMatch =
  out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
  out.match(/group[=:\s]+([a-f0-9-]{36})/i);
const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);

const summary = {
  timestamp: new Date().toISOString(),
  commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  channel: CHANNEL,
  runtime: RUNTIME,
  groupId: groupMatch ? groupMatch[1] : null,
  androidUpdateId: androidMatch ? androidMatch[1] : null,
};

const summaryPath = path.join(__dirname, '..', 'ota-publish-playback-stability-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log('\n[publish-playback-stability-ota] production 1.8.2 published');
console.log(JSON.stringify(summary, null, 2));
