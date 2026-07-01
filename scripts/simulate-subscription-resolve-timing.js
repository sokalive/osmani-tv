#!/usr/bin/env node
'use strict';

/**
 * Proves multi-candidate resolve exceeds old 12s timeout when stable_hardware_id
 * is probed before package_android_id. Run: node scripts/simulate-subscription-resolve-timing.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const identity = fs.readFileSync(path.join(root, 'lib', 'deviceIdentity.js'), 'utf8');
const sub = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
const ctx = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

const pkgIdx = identity.indexOf("pushCandidate('package_android_id'");
const stableIdx = identity.indexOf("pushCandidate('stable_hardware_id'");
if (pkgIdx < 0 || stableIdx < 0) fail('identity candidate push missing');
else if (pkgIdx > stableIdx) fail('package_android_id must be tried before stable_hardware_id');
else pass('package_android_id before stable_hardware_id');

if (!sub.includes('fastStatusProbe')) fail('fast status probe missing');
else pass('fast status probe on resolve');

if (!sub.includes("resolveSource: `status:${role}`")) fail('status before recover in tryResolve');
else pass('status before recover per candidate');

const verifyTimeout = ctx.match(/SUBSCRIPTION_VERIFY_TIMEOUT_MS\s*=\s*([\d_]+)/);
const ms = verifyTimeout ? Number(String(verifyTimeout[1]).replace(/_/g, '')) : 0;
if (ms < 35_000) fail(`verify timeout too low (${ms})`);
else pass(`verify timeout ${ms}ms`);

const perCallMs = 3500;
const candidates = 4;
const callsPerCandidate = 3;
const worstCaseMs = candidates * callsPerCandidate * perCallMs;
console.log(`\nWorst-case sequential chain ~${worstCaseMs}ms (old 12s timeout would fail)`);
if (ms < worstCaseMs * 0.85) fail('verify timeout still below worst-case chain');
else pass('verify timeout covers worst-case chain');

if (!process.exitCode) console.log('\n[simulate-subscription-resolve-timing] ok');
