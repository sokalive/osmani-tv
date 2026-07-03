#!/usr/bin/env node
'use strict';

/**
 * Pre-deployment gate — runs automated regression suite.
 * Does NOT replace physical device QA or production population audit.
 *
 * Run: node scripts/verify-pre-deployment-gate.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const SCRIPTS = [
  'scripts/verify-startup-health.mjs',
  'scripts/verify-account-display-sparse.js',
  'scripts/verify-account-subscription-cards.js',
  'scripts/verify-account-subscription-price.js',
  'scripts/verify-startup-crash-guard.js',
  'scripts/verify-phone-subscription-guard.js',
  'scripts/verify-phone-number-gate.js',
  'scripts/verify-payment-waiting-ui.js',
  'scripts/verify-payment-success-ui.js',
  'scripts/verify-payment-completion.js',
  'scripts/verify-subscription-instant-ux.js',
  'scripts/verify-subscription-sse-guard.js',
  'scripts/verify-subscription-cache-hydrate.js',
  'scripts/verify-subscription-canonical-display.js',
  'scripts/verify-premium-playback-regression.js',
  'scripts/verify-subscription-recovery-boot.js',
  'scripts/verify-payment-plans-instant.js',
  'scripts/verify-user-center-sync.js',
  'scripts/verify-push-notification-registration.js',
];

const report = {
  timestamp: new Date().toISOString(),
  commit: null,
  automated: [],
  passed: 0,
  failed: 0,
  skipped: 0,
  physicalDeviceQa: 'NOT_RUN — requires Tecno BG6, Samsung, +1 Android',
  productionPopulationAudit: 'NOT_RUN — requires DEVICE_IDS_FILE from Admin',
  deployment: 'BLOCKED',
};

try {
  report.commit = require('child_process')
    .execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' })
    .trim();
} catch {
  report.commit = 'unknown';
}

console.log('[verify-pre-deployment-gate] commit', report.commit);
console.log('');

for (const rel of SCRIPTS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    report.skipped += 1;
    report.automated.push({ script: rel, status: 'SKIP', reason: 'missing' });
    console.log('SKIP (missing):', rel);
    continue;
  }
  console.log(`\n=== ${rel} ===`);
  const result = spawnSync(process.execPath, [abs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
    shell: false,
  });
  const ok = result.status === 0;
  report.automated.push({ script: rel, status: ok ? 'PASS' : 'FAIL', exitCode: result.status });
  if (ok) {
    report.passed += 1;
    console.log(`PASS: ${rel}`);
  } else {
    report.failed += 1;
    console.error(`FAIL: ${rel} (exit ${result.status})`);
  }
}

const outPath = path.join(root, 'pre-deployment-gate-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('\n[verify-pre-deployment-gate] automated summary', {
  passed: report.passed,
  failed: report.failed,
  skipped: report.skipped,
});
console.log('[verify-pre-deployment-gate] wrote', outPath);

const populationAudit = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/audit-account-display-production.js')],
  { cwd: root, encoding: 'utf8' },
);
if (populationAudit.status !== 0) {
  console.log('\n[verify-pre-deployment-gate] population audit: BLOCKED (no DEVICE_IDS_FILE)');
  report.productionPopulationAudit = 'BLOCKED — export active device_ids from Admin';
} else {
  report.productionPopulationAudit = 'PASS';
}

if (report.failed > 0) {
  console.error('\n[verify-pre-deployment-gate] FAIL — fix automated regressions');
  process.exit(1);
}

console.log('\n[verify-pre-deployment-gate] automated regressions PASS');
console.log('DEPLOYMENT STILL BLOCKED until:');
console.log('  1) Physical device matrix (3+ devices × all activation paths)');
console.log('  2) audit-account-display-production.js activeIncomplete = 0');
console.log('  3) Explicit deploy approval');
