#!/usr/bin/env node
'use strict';

/**
 * Publish payment-flow red UI redesign + catalog freshness OTA for Version 24.
 * Targets runtime 1.8.2 (versionCode 24) on both:
 * - production (Play / production-channel binaries)
 * - preview (landing-page OSMAN-TV.apk from osman-tv-landing.vercel.app)
 * Usage: node scripts/publish-payment-ui-redesign-ota.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIMES = ['1.8.2'];
/** Landing APK is channel `preview`; Play builds typically use `production`. */
const CHANNELS = ['production', 'preview'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const logPath = path.join(__dirname, '..', 'ota-publish-payment-ui-redesign.log');
const groups = [];

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {}
}

fs.writeFileSync(logPath, `[publish-payment-ui-redesign-ota] started ${new Date().toISOString()}\n`);

for (const runtime of RUNTIMES) {
  for (const channel of CHANNELS) {
    const msg =
      channel === 'preview'
        ? `fix(payment-ui): red payment flow for Version 24 landing APK preview channel`
        : `fix(payment-ui): red payment flow match references + faster catalog sync runtime ${runtime}`;
    console.log(`\n=== OTA runtime ${runtime} channel ${channel} ===`);
    appendLog(`\n=== OTA runtime ${runtime} channel ${channel} ===`);

    const quotedMsg = msg.replace(/"/g, '');
    const cmd =
      `${NPX} eas-cli update --channel ${channel} --environment production ` +
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
        EXPO_PUBLIC_MEDIA_CDN_BASE: 'https://osmanitv.b-cdn.net',
      },
    });

    const out = `${result.stdout || ''}${result.stderr || ''}`;
    process.stdout.write(out);
    appendLog(out);

    if (result.status !== 0) {
      console.error(`FAILED runtime ${runtime} channel ${channel} exit ${result.status}`);
      appendLog(`FAILED exit ${result.status}`);
      process.exit(result.status ?? 1);
    }

    const groupMatch =
      out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
      out.match(/group[=:\s]+([a-f0-9-]{36})/i);
    const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);

    groups.push({
      runtime,
      channel,
      groupId: groupMatch ? groupMatch[1] : null,
      androidUpdateId: androidMatch ? androidMatch[1] : null,
    });
  }
}

const summary = {
  timestamp: new Date().toISOString(),
  commit: null,
  channels: CHANNELS,
  versionCodeTarget: 24,
  groups,
};

try {
  summary.commit = require('child_process')
    .execSync('git rev-parse HEAD', { encoding: 'utf8' })
    .trim();
} catch {}

const summaryPath = path.join(__dirname, '..', 'ota-publish-payment-ui-redesign-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log('\n[publish-payment-ui-redesign-ota] published');
console.log('[publish-payment-ui-redesign-ota] summary', JSON.stringify(groups, null, 2));
