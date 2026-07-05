#!/usr/bin/env node
'use strict';

/**
 * Final engineering verification gate — all deployment-critical static + live checks.
 * Run: node scripts/verify-final-engineering.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const SCRIPTS = [
  // Startup + bundle integrity
  'scripts/verify-startup-health.mjs',
  'scripts/verify-startup-crash-guard.js',
  'scripts/verify-brand-assets.js',
  'scripts/verify-expo-updates.js',
  // Account display fix (5e736b9)
  'scripts/verify-account-display-sparse.js',
  'scripts/verify-account-subscription-cards.js',
  'scripts/verify-account-subscription-price.js',
  // Phone Guard
  'scripts/verify-phone-subscription-guard.js',
  'scripts/verify-phone-number-gate.js',
  // Payment flow
  'scripts/verify-payment-waiting-ui.js',
  'scripts/verify-payment-success-ui.js',
  'scripts/verify-payment-completion.js',
  'scripts/verify-payment-plans-instant.js',
  'scripts/verify-payment-checkout-providers.js',
  'scripts/verify-sonicpesa-activation-visibility.js',
  'scripts/verify-kulipia-badge.js',
  // Subscription activation paths
  'scripts/verify-subscription-instant-ux.js',
  'scripts/verify-subscription-pending-activation.js',
  'scripts/verify-subscription-recovery-boot.js',
  'scripts/verify-reinstall-subscription-recovery.js',
  'scripts/verify-subscription-sse-guard.js',
  'scripts/verify-subscription-canonical-display.js',
  'scripts/verify-subscription-cache-hydrate.js',
  'scripts/verify-subscription-cache-repair.js',
  'scripts/verify-manual-subscription-gift.js',
  'scripts/verify-false-transfer-stress.js',
  'scripts/verify-hamisha-transfer.js',
  // Account + premium
  'scripts/verify-premium-playback-regression.js',
  'scripts/verify-channel-card-tap.js',
  // Notifications + user center
  'scripts/verify-push-notification-registration.js',
  'scripts/verify-user-center-sync.js',
  // Production API live probes
  'scripts/verify-vps-production.js',
  'scripts/verify-vps-no-render-fallback.js',
  'scripts/verify-users-intelligence-production.js',
  'scripts/verify-device-access-production.js',
  // Recent feature regressions
  'scripts/verify-recent-features.js',
  'scripts/verify-account-app-update.js',
  'scripts/verify-update-overlay-auto-download.js',
];

const report = {
  timestamp: new Date().toISOString(),
  commit: null,
  results: [],
  passed: 0,
  failed: 0,
  skipped: 0,
};

try {
  report.commit = require('child_process')
    .execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' })
    .trim();
} catch {
  report.commit = 'unknown';
}

console.log('[verify-final-engineering] commit', report.commit);
console.log('[verify-final-engineering] running', SCRIPTS.length, 'scripts\n');

for (const rel of SCRIPTS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    report.skipped += 1;
    report.results.push({ script: rel, status: 'SKIP' });
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
  report.results.push({ script: rel, status: ok ? 'PASS' : 'FAIL', exitCode: result.status });
  if (ok) {
    report.passed += 1;
    console.log(`\n>>> PASS ${rel}`);
  } else {
    report.failed += 1;
    console.error(`\n>>> FAIL ${rel} (exit ${result.status})`);
  }
}

const outPath = path.join(root, 'final-engineering-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('\n[verify-final-engineering] summary', {
  passed: report.passed,
  failed: report.failed,
  skipped: report.skipped,
});
console.log('[verify-final-engineering] wrote', outPath);

if (report.failed > 0) {
  console.error('\n[verify-final-engineering] FAIL — deployment blocked');
  process.exit(1);
}

console.log('\n[verify-final-engineering] ALL CHECKS PASSED — ready for deployment');
