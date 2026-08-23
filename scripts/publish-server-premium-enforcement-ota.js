#!/usr/bin/env node
'use strict';

/**
 * Publish Phase 2 FINAL server premium enforcement OTA to every Play production runtime.
 *
 * Usage: node scripts/publish-server-premium-enforcement-ota.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIMES = ['1.6.0', '1.7.0', '1.7.1', '1.7.2', '1.8.0', '1.8.1', '1.8.2'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const logPath = path.join(__dirname, '..', 'ota-publish-server-premium-enforcement.log');
const groups = [];

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {
    // non-fatal
  }
}

fs.writeFileSync(logPath, `[publish-server-premium-enforcement-ota] started ${new Date().toISOString()}\n`);

for (const runtime of RUNTIMES) {
  const msg = `feat(playback): server-side premium entitlement authorize OTA runtime ${runtime}`;
  console.log(`\n=== OTA runtime ${runtime} ===`);
  appendLog(`\n=== OTA runtime ${runtime} ===`);

  const quotedMsg = msg.replace(/"/g, '');
  const cmd =
    `${NPX} eas-cli update --channel production --environment production ` +
    `--message "${quotedMsg}" --non-interactive`;
  const result = spawnSync(cmd, {
    stdio: 'pipe',
    shell: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      EAS_SKIP_AUTO_FINGERPRINT: '1',
      OTA_RUNTIME_TARGET: runtime,
      EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
    },
  });

  const out = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(out);
  appendLog(out);

  if (result.status !== 0) {
    console.error(`FAILED runtime ${runtime} exit ${result.status}`);
    appendLog(`FAILED exit ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const groupMatch =
    out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
    out.match(/group[=:\s]+([a-f0-9-]{36})/i);
  const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);

  groups.push({
    runtime,
    groupId: groupMatch ? groupMatch[1] : null,
    androidUpdateId: androidMatch ? androidMatch[1] : null,
  });
}

const summary = {
  timestamp: new Date().toISOString(),
  commit: null,
  channel: 'production',
  groups,
};

try {
  summary.commit = require('child_process')
    .execSync('git rev-parse HEAD', { encoding: 'utf8' })
    .trim();
} catch {
  summary.commit = 'unknown';
}

const summaryPath = path.join(__dirname, '..', 'ota-publish-server-premium-enforcement-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log('\n[publish-server-premium-enforcement-ota] all runtimes published');
console.log('[publish-server-premium-enforcement-ota] summary', JSON.stringify(groups, null, 2));
console.log('[publish-server-premium-enforcement-ota] wrote', summaryPath);
