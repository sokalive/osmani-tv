#!/usr/bin/env node
/**
 * Production startup health gate — runs all static startup verifications + bundle smoke.
 * Run: node scripts/verify-startup-health.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function runNode(scriptRel) {
  const scriptPath = path.join(root, scriptRel);
  console.log(`\n=== ${scriptRel} ===`);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  if (result.status !== 0) {
    console.error(`\n[verify-startup-health] failed at ${scriptRel}`);
    process.exit(result.status || 1);
  }
}

const scripts = [
  'scripts/verify-startup-imports.mjs',
  'scripts/verify-startup-regressions.mjs',
  'scripts/verify-startup-crash-guard.js',
];

for (const s of scripts) {
  runNode(s);
}

console.log('\n=== expo export smoke (startup bundle) ===');
const outDir = path.join(root, 'dist-startup-health-check');
const exportResult = spawnSync(
  'npx',
  ['expo', 'export', '--platform', 'android', '--output-dir', outDir],
  { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, CI: '1' } },
);

if (exportResult.status !== 0) {
  console.error('[verify-startup-health] expo export smoke failed');
  process.exit(exportResult.status || 1);
}

const bundleGlob = path.join(outDir, '_expo', 'static', 'js', 'android');
if (!fs.existsSync(bundleGlob)) {
  console.error('[verify-startup-health] android bundle output missing');
  process.exit(1);
}

console.log('\n[verify-startup-health] ok — startup static checks + bundle smoke passed');
