#!/usr/bin/env node
'use strict';

/**
 * PRODUCTION OTA RECOVERY — VersionCode 24 / Runtime 1.8.2
 *
 * Root cause: identical native APKs (versionCode 24, runtime 1.8.2) listen to
 * DIFFERENT Expo Update channels baked at build time:
 *
 *   preview      — CDN / sideload VPS APK (osmani-v24-1.8.2.apk)
 *   vps-preview  — EAS profile vps-preview APK builds
 *   production   — Play Store / production AAB
 *
 * Publishing only to `production` leaves preview + vps-preview installs behind.
 * This script publishes the SAME HEAD bundle to ALL three channels.
 *
 * Usage: node scripts/publish-v24-ota-channel-recovery.js
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = '1.8.2';
const CHANNELS = ['preview', 'vps-preview', 'production'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const MAX_ATTEMPTS = 4;
const logPath = path.join(__dirname, '..', 'ota-publish-v24-channel-recovery.log');
const summaryPath = path.join(__dirname, '..', 'ota-publish-v24-channel-recovery-summary.json');

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {
    /* ignore */
  }
}

function sleepSec(sec) {
  try {
    if (process.platform === 'win32') {
      execSync(`timeout /t ${sec} /nobreak`, { stdio: 'ignore' });
    } else {
      execSync(`sleep ${sec}`, { stdio: 'ignore' });
    }
  } catch {
    /* ignore */
  }
}

function publishChannel(channel) {
  const msg = `fix(ota): v24 channel recovery — sync all 1.8.2 installs ${channel}`;
  const quotedMsg = msg.replace(/"/g, '');
  const envFlag = channel === 'production' ? '--environment production ' : '';
  const cmd =
    `${NPX} eas-cli update --channel ${channel} ${envFlag}` +
    `--message "${quotedMsg}" --non-interactive`;
  return spawnSync(cmd, {
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
}

fs.writeFileSync(logPath, `[publish-v24-ota-channel-recovery] started ${new Date().toISOString()}\n`);

const groups = [];

for (const channel of CHANNELS) {
  let published = false;
  let group = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(
      `\n=== RECOVERY OTA channel=${channel} runtime=${RUNTIME} attempt=${attempt}/${MAX_ATTEMPTS} ===`,
    );
    appendLog(`\n=== channel ${channel} attempt ${attempt} ===`);
    const result = publishChannel(channel);
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    process.stdout.write(out);
    appendLog(out);
    if (result.status === 0) {
      const groupMatch =
        out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
        out.match(/group[=:\s]+([a-f0-9-]{36})/i);
      const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);
      group = {
        channel,
        runtime: RUNTIME,
        groupId: groupMatch ? groupMatch[1] : null,
        androidUpdateId: androidMatch ? androidMatch[1] : null,
      };
      published = true;
      break;
    }
    console.error(`FAILED channel ${channel} attempt ${attempt}`);
    if (attempt < MAX_ATTEMPTS) sleepSec(attempt * 15);
  }

  if (!published) {
    console.error(`GAVE UP channel ${channel}`);
    process.exit(1);
  }
  groups.push(group);
}

let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* ignore */
}

const summary = {
  timestamp: new Date().toISOString(),
  commit,
  runtime: RUNTIME,
  versionCode: 24,
  channels: CHANNELS,
  groups,
  rootCause:
    'Identical versionCode 24 / runtime 1.8.2 APKs are baked with different expo-channel-name values (preview | vps-preview | production). OTA published to only one channel never reaches the others.',
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log('\n[publish-v24-ota-channel-recovery] DONE');
console.log(JSON.stringify(groups, null, 2));
