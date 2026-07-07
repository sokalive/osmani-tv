#!/usr/bin/env node
'use strict';

/**
 * Publish canonical entitlement state machine OTA to every Play runtime.
 * Usage: node scripts/publish-entitlement-state-machine-ota.js
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PRIORITY = ['1.8.2', '1.8.1', '1.8.0', '1.7.2', '1.7.1', '1.7.0', '1.6.0'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const MAX_ATTEMPTS = 4;
const logPath = path.join(__dirname, '..', 'ota-publish-entitlement-state-machine.log');
const groups = [];

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
  const msg = `fix(premium): context-aware access prompt + intent-only display runtime ${runtime}`;
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

fs.writeFileSync(logPath, `[publish-entitlement-state-machine-ota] started ${new Date().toISOString()}\n`);

for (const runtime of PRIORITY) {
  let published = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n=== OTA runtime ${runtime} (attempt ${attempt}/${MAX_ATTEMPTS}) ===`);
    appendLog(`\n=== OTA runtime ${runtime} attempt ${attempt} ===`);
    const result = publishRuntime(runtime);
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    process.stdout.write(out);
    appendLog(out);
    if (result.status === 0) {
      const groupMatch =
        out.match(/Update group ID\s+([a-f0-9-]{36})/i) ||
        out.match(/group[=:\s]+([a-f0-9-]{36})/i);
      const androidMatch = out.match(/Android update ID\s+([a-f0-9-]{36})/i);
      groups.push({
        runtime,
        groupId: groupMatch ? groupMatch[1] : null,
        androidUpdateId: androidMatch ? androidMatch[1] : null,
      });
      published = true;
      break;
    }
    console.error(`FAILED runtime ${runtime} attempt ${attempt}`);
    if (attempt < MAX_ATTEMPTS) sleepSec(attempt * 15);
  }
  if (!published) {
    console.error(`GAVE UP runtime ${runtime}`);
    process.exit(1);
  }
}

const summary = {
  timestamp: new Date().toISOString(),
  commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  groups,
};

const summaryPath = path.join(__dirname, '..', 'ota-publish-premium-entry-regression-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log('\n[publish-entitlement-state-machine-ota] all runtimes published');
console.log(JSON.stringify(groups, null, 2));
