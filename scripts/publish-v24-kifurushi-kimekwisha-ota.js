#!/usr/bin/env node
'use strict';

/**
 * Publish Kifurushi kimekwisha popup removal — VPS v24 production runtime only (1.8.2).
 * Usage: node scripts/publish-v24-kifurushi-kimekwisha-ota.js
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = '1.8.2';
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

function publishRuntime(runtime) {
  const msg = `fix(player): remove Kifurushi kimekwisha popup VPS v24 runtime ${runtime}`;
  const quotedMsg = msg.replace(/"/g, '');
  const cmd =
    `${NPX} eas-cli update --channel production --environment production ` +
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

let published = false;
let group = null;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  console.log(`\n=== OTA VPS v24 runtime ${RUNTIME} (attempt ${attempt}/${MAX_ATTEMPTS}) ===`);
  appendLog(`\n=== OTA runtime ${RUNTIME} attempt ${attempt} ===`);
  const result = publishRuntime(RUNTIME);
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(out);
  appendLog(out);
  if (result.status === 0) {
    const groupMatch =
      out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
      out.match(/group[=:\s]+([a-f0-9-]{36})/i);
    const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);
    group = {
      runtime: RUNTIME,
      groupId: groupMatch ? groupMatch[1] : null,
      androidUpdateId: androidMatch ? androidMatch[1] : null,
    };
    published = true;
    break;
  }
  console.error(`FAILED runtime ${RUNTIME} attempt ${attempt}`);
  if (attempt < MAX_ATTEMPTS) sleepSec(attempt * 15);
}

if (!published) {
  console.error(`GAVE UP runtime ${RUNTIME}`);
  process.exit(1);
}

const summary = {
  timestamp: new Date().toISOString(),
  commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  groups: [group],
};

const summaryPath = path.join(__dirname, '..', 'ota-publish-v24-kifurushi-kimekwisha-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log('\n[publish-v24-kifurushi-kimekwisha-ota] VPS v24 published');
console.log(JSON.stringify(group, null, 2));
