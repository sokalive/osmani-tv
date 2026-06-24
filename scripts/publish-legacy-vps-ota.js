#!/usr/bin/env node
'use strict';

/**
 * Publish VPS migration OTA to every Play runtime (16–24).
 * Usage: node scripts/publish-legacy-vps-ota.js [--dry-run]
 */

const { spawnSync } = require('child_process');

const RUNTIMES = ['1.6.0', '1.7.0', '1.7.1', '1.7.2', '1.8.0', '1.8.1', '1.8.2'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const dryRun = process.argv.includes('--dry-run');

for (const runtime of RUNTIMES) {
  const msg = `fix-account-UpdateApp-${runtime}`;
  console.log(`\n=== OTA runtime ${runtime} ===`);
  if (dryRun) {
    console.log(`[dry-run] OTA_RUNTIME_TARGET=${runtime} eas update --channel production`);
    continue;
  }
  const quotedMsg = msg.replace(/"/g, '');
  const cmd =
    `${NPX} eas-cli update --channel production --environment production ` +
    `--message "${quotedMsg}" --non-interactive`;
  const result = spawnSync(cmd, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      CI: '1',
      OTA_RUNTIME_TARGET: runtime,
      EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
    },
  });
  if (result.status !== 0) {
    console.error(`FAILED runtime ${runtime} exit ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[publish-legacy-vps-ota] all runtimes published');
