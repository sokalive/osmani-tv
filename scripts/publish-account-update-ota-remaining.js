#!/usr/bin/env node
'use strict';

/**
 * Publish Update App section OTA for runtimes that failed or were never published.
 * Usage: node scripts/publish-account-update-ota-remaining.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNTIMES = ['1.8.0', '1.8.1', '1.8.2'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = path.join(__dirname, '..');
const distMeta = path.join(root, 'dist', 'metadata.json');

function waitForMetadata(maxMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      if (fs.existsSync(distMeta) && fs.statSync(distMeta).size > 0) return true;
    } catch {}
    spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', ['1'], { stdio: 'ignore', shell: true });
  }
  return false;
}

for (const runtime of RUNTIMES) {
  const msg = `fix-account-UpdateApp-visible-${runtime}`;
  console.log(`\n=== OTA runtime ${runtime} ===`);
  const quotedMsg = msg.replace(/"/g, '');
  const cmd =
    `${NPX} eas-cli update --channel production --environment production ` +
    `--message "${quotedMsg}" --non-interactive`;
  const result = spawnSync(cmd, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env: {
      ...process.env,
      CI: '1',
      EAS_SKIP_AUTO_FINGERPRINT: '1',
      OTA_RUNTIME_TARGET: runtime,
      EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
    },
  });
  if (result.status !== 0) {
    if (!waitForMetadata()) {
      console.error(`metadata.json missing after export for ${runtime}`);
    }
    console.error(`FAILED runtime ${runtime} exit ${result.status}`);
    process.exit(result.status ?? 1);
  }
  console.log(`Published runtime ${runtime}`);
}

console.log('\n[publish-account-update-ota-remaining] all runtimes published');
