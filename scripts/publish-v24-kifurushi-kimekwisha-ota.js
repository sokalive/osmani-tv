#!/usr/bin/env node
'use strict';

/**
 * Publish final Home expired-package popup removal — VPS v24 runtime 1.8.2.
 *
 * CRITICAL: The production CDN APK (osmani-v24-1.8.2.apk) is baked with
 * expo-channel-name **preview** (not vps-preview). Publishing only to
 * vps-preview/production leaves every CDN VPS device on the embedded July 6
 * bundle forever — checkForUpdate never sees the fix.
 *
 * Channels:
 * - preview      — CDN / sideload VPS APK (versionCode 24)  ← PRIMARY
 * - vps-preview  — EAS profile vps-preview builds
 * - production   — Play Store / production AAB
 *
 * Usage: node scripts/publish-v24-kifurushi-kimekwisha-ota.js
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = '1.8.2';
const CHANNELS = ['preview', 'vps-preview', 'production'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const MAX_ATTEMPTS = 4;
const logPath = path.join(__dirname, '..', 'ota-publish-v24-kifurushi-kimekwisha.log');

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {}
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

function publishChannel(channel, runtime) {
  const msg = `fix(popup): permanently remove expired-package Home popup VPS v24 ${channel} runtime ${runtime}`;
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
      OTA_RUNTIME_TARGET: runtime,
      EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
    },
  });
}

fs.writeFileSync(logPath, `[publish-v24-kifurushi-kimekwisha-ota] started ${new Date().toISOString()}\n`);

const groups = [];

for (const channel of CHANNELS) {
  let published = false;
  let group = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(
      `\n=== OTA VPS v24 channel ${channel} runtime ${RUNTIME} (attempt ${attempt}/${MAX_ATTEMPTS}) ===`,
    );
    appendLog(`\n=== OTA channel ${channel} runtime ${RUNTIME} attempt ${attempt} ===`);
    const result = publishChannel(channel, RUNTIME);
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

const summary = {
  timestamp: new Date().toISOString(),
  commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  groups,
};

const summaryPath = path.join(__dirname, '..', 'ota-publish-v24-kifurushi-kimekwisha-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log('\n[publish-v24-kifurushi-kimekwisha-ota] VPS v24 published (vps-preview + production)');
console.log(JSON.stringify(groups, null, 2));
