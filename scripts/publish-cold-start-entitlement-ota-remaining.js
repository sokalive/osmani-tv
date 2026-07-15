#!/usr/bin/env node
'use strict';

/**
 * Resume cold-start entitlement OTA after partial publish.
 * 1.6.0 already published — publish remaining runtimes with retry.
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PRIORITY = ['1.8.2', '1.7.0', '1.7.1', '1.7.2', '1.8.0', '1.8.1'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const MAX_ATTEMPTS = 4;
const logPath = path.join(__dirname, '..', 'ota-publish-cold-start-entitlement.log');

const existing = [
  {
    runtime: '1.6.0',
    groupId: '1d3adee7-3ee6-4aa6-a623-517fc69ec040',
    androidUpdateId: '019f388a-731d-7d9e-b6da-1cdae8db283f',
  },
];

const groups = [...existing];

function appendLog(text) {
  try {
    fs.appendFileSync(logPath, text + '\n');
  } catch {}
}

function publishRuntime(runtime) {
  const msg = `fix(entitlement): cold-start tri-state tap gate runtime ${runtime}`;
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

    console.error(`FAILED runtime ${runtime} attempt ${attempt} exit ${result.status}`);
    appendLog(`FAILED attempt ${attempt} exit ${result.status}`);
    if (attempt < MAX_ATTEMPTS) {
      const waitSec = attempt * 15;
      console.log(`Retrying in ${waitSec}s...`);
      try {
        if (process.platform === 'win32') {
          execSync(`timeout /t ${waitSec} /nobreak`, { stdio: 'ignore' });
        } else {
          execSync(`sleep ${waitSec}`, { stdio: 'ignore' });
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!published) {
    console.error(`GAVE UP runtime ${runtime}`);
    process.exit(1);
  }
}

const summary = {
  timestamp: new Date().toISOString(),
  commit: null,
  groups,
};

try {
  summary.commit = require('child_process')
    .execSync('git rev-parse HEAD', { encoding: 'utf8' })
    .trim();
} catch {}

const summaryPath = path.join(__dirname, '..', 'ota-publish-cold-start-entitlement-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log('\n[publish-cold-start-entitlement-ota-remaining] all runtimes published');
console.log(JSON.stringify(groups, null, 2));
