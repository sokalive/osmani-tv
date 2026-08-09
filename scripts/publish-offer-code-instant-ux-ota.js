#!/usr/bin/env node
'use strict';

/**
 * Publish Offer Code instant success UX OTA (runtime 1.8.2).
 * Channels: preview (primary CDN APK), vps-preview, production.
 * Usage: node scripts/publish-offer-code-instant-ux-ota.js
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = '1.8.2';
const CHANNELS = ['preview', 'vps-preview', 'production'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const logPath = path.join(__dirname, '..', 'ota-publish-offer-code-instant-ux.log');
const summaryPath = path.join(__dirname, '..', 'ota-publish-offer-code-instant-ux-summary.json');
const groups = [];

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {
    /* ignore */
  }
}

fs.writeFileSync(logPath, `[publish-offer-code-instant-ux-ota] started ${new Date().toISOString()}\n`);

for (const channel of CHANNELS) {
  const msg = `fix(app): Offer Code instant Home+Hongera on redeem SUCCESS v24 ${channel} runtime ${RUNTIME}`;
  console.log(`\n=== OTA channel ${channel} runtime ${RUNTIME} ===`);
  appendLog(`\n=== OTA channel ${channel} runtime ${RUNTIME} ===`);

  const quotedMsg = msg.replace(/"/g, '');
  const envFlag = channel === 'production' ? '--environment production ' : '';
  const cmd =
    `${NPX} eas-cli update --channel ${channel} ${envFlag}` +
    `--message "${quotedMsg}" --non-interactive`;

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
    console.error(`FAILED channel ${channel} exit ${result.status}`);
    appendLog(`FAILED exit ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const groupMatch =
    out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
    out.match(/group[=:\s]+([a-f0-9-]{36})/i);
  const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);

  groups.push({
    channel,
    runtime: RUNTIME,
    groupId: groupMatch ? groupMatch[1] : null,
    androidUpdateId: androidMatch ? androidMatch[1] : null,
  });
}

const summary = {
  timestamp: new Date().toISOString(),
  commit: null,
  runtime: RUNTIME,
  versionCode: 24,
  groups,
};

try {
  summary.commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* ignore */
}

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log('\n[publish-offer-code-instant-ux-ota] published');
console.log('[publish-offer-code-instant-ux-ota] summary', JSON.stringify(groups, null, 2));
console.log('[publish-offer-code-instant-ux-ota] wrote', summaryPath);
