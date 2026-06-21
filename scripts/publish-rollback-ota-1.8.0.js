#!/usr/bin/env node
'use strict';

/**
 * Roll back runtime 1.8.0 (v22) OTA to stable f7cb49b + VPS migration.
 * Does not change main branch app code — uses a temporary git worktree.
 *
 * Usage: node scripts/publish-rollback-ota-1.8.0.js [--dry-run]
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STABLE_COMMIT = 'f7cb49b6d7396cc8a6a3a1dae23bd5294c6742a2';
const RUNTIME = '1.8.0';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const dryRun = process.argv.includes('--dry-run');
const repoRoot = path.join(__dirname, '..');
const worktreeDir = path.join(repoRoot, '.ota-worktree-1.8.0');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (result.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')} exit ${result.status ?? 'null'}`);
    process.exit(result.status ?? 1);
  }
}

function cleanup() {
  if (fs.existsSync(worktreeDir)) {
    run('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: repoRoot });
  }
}

console.log(`[rollback-ota-1.8.0] stable source ${STABLE_COMMIT}`);
cleanup();

run('git', ['worktree', 'add', '--detach', worktreeDir, STABLE_COMMIT], { cwd: repoRoot });

const msg = `rollback(ota): restore stable runtime ${RUNTIME} from f7cb49b (VPS preserved)`;
console.log(`\n=== OTA runtime ${RUNTIME} from worktree ===`);

if (dryRun) {
  console.log(`[dry-run] OTA_RUNTIME_TARGET=${RUNTIME} eas update --channel production`);
  cleanup();
  process.exit(0);
}

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
    cwd: worktreeDir,
    env: {
      ...process.env,
      CI: '1',
      OTA_RUNTIME_TARGET: RUNTIME,
      EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
    },
  },
);

cleanup();

if (result.status !== 0) {
  console.error(`FAILED runtime ${RUNTIME} exit ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log('\n[publish-rollback-ota-1.8.0] ok');
