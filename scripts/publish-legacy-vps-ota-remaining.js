#!/usr/bin/env node
'use strict';

/** Publish remaining runtimes after 1.6.0 (already published). */
const { spawnSync } = require('child_process');

const RUNTIMES = ['1.7.0', '1.7.1', '1.7.2', '1.8.0', '1.8.1', '1.8.2'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

for (const runtime of RUNTIMES) {
  const msg = `fix(api): VPS migration legacy runtime ${runtime}`;
  console.log(`\n=== OTA runtime ${runtime} ===`);
  const result = spawnSync(
    NPX,
    [
      'eas-cli',
      'update',
      '--channel',
      'production',
      '--environment',
      'production',
      '--message',
      msg,
      '--non-interactive',
    ],
    {
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        CI: '1',
        OTA_RUNTIME_TARGET: runtime,
        EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
      },
    },
  );
  if (result.status !== 0) {
    console.error(`FAILED runtime ${runtime} exit ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[publish-legacy-vps-ota-remaining] ok');
