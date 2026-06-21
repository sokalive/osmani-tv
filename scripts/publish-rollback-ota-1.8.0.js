#!/usr/bin/env node
'use strict';

/**
 * Roll back runtime 1.8.0 (v22) OTA to stable f7cb49b + VPS migration.
 * Temporarily restores f7cb49b tree, publishes OTA, then hard-resets to saved HEAD.
 *
 * Usage: node scripts/publish-rollback-ota-1.8.0.js [--dry-run]
 */

const { spawnSync } = require('child_process');
const path = require('path');

const STABLE_COMMIT = 'f7cb49b';
const RUNTIME = '1.8.0';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const dryRun = process.argv.includes('--dry-run');
const repoRoot = path.join(__dirname, '..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (result.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')} exit ${result.status ?? 'null'}`);
    process.exit(result.status ?? 1);
  }
}

function getHead() {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
}

console.log(`[rollback-ota-1.8.0] stable source ${STABLE_COMMIT}`);
const savedHead = getHead();
console.log(`[rollback-ota-1.8.0] saving HEAD ${savedHead}`);

run('git', ['restore', '--source', STABLE_COMMIT, '--worktree', '--staged', '.'], { cwd: repoRoot });

const msg = `rollback ota restore stable runtime ${RUNTIME} from ${STABLE_COMMIT} VPS preserved`;
console.log(`\n=== OTA runtime ${RUNTIME} from ${STABLE_COMMIT} tree ===`);

if (dryRun) {
  console.log(`[dry-run] OTA_RUNTIME_TARGET=${RUNTIME} eas update --channel production`);
  run('git', ['reset', '--hard', savedHead], { cwd: repoRoot });
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
    shell: true,
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: '1',
      OTA_RUNTIME_TARGET: RUNTIME,
      EXPO_PUBLIC_API_URL: 'https://api.osmanitv.com',
    },
  },
);

run('git', ['reset', '--hard', savedHead], { cwd: repoRoot });
console.log(`[rollback-ota-1.8.0] restored HEAD ${savedHead}`);

if (result.status !== 0) {
  console.error(`FAILED runtime ${RUNTIME} exit ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log('\n[publish-rollback-ota-1.8.0] ok');
