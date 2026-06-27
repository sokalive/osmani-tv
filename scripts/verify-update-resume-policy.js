#!/usr/bin/env node
'use strict';

/**
 * Static checks: soft update shows once per session; resume/SSE recheck without re-popup.
 * Run: node scripts/verify-update-resume-policy.js
 */

const fs = require('fs');
const path = require('path');

const updateClient = fs.readFileSync(path.join(__dirname, '..', 'lib', 'updateClient.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (/RESUME_RECHECK_GUARD_MS\s*=\s*60_000/.test(updateClient)) {
  fail('60s resume recheck guard must be removed');
} else pass('no 60s resume recheck guard');

if (!updateClient.includes("scheduleCheck('app-resume', 0)")) {
  fail('app-resume must schedule immediate update-check');
} else pass('app-resume schedules silent recheck');

if (updateClient.includes('reassertSoftOverlayVisibility')) {
  fail('must not reassert soft overlay on every resume');
} else pass('no resume overlay reassert');

if (!updateClient.includes("reason === 'app-launch') softUpdateDismissed = false")) {
  fail('app-launch must reset session dismiss flag');
} else pass('app-launch resets session dismiss');

if (!updateClient.includes('softUpdateDismissed && !mandatory')) {
  fail('soft dismiss must suppress overlay for non-mandatory updates');
} else pass('session dismiss honored');

if (updateClient.includes("reason !== 'app-resume'")) {
  fail('app-resume must not bypass session dismiss');
} else pass('app-resume respects session dismiss');

if (!updateClient.includes('IMMEDIATE_CHECK_REASONS')) {
  fail('launch/resume must bypass recheck debounce');
} else pass('launch/resume bypass recheck debounce');

if (!updateClient.includes('performJsOnlyUpdateCheck')) {
  fail('JS-only update-check path required');
} else pass('JS-only update-check path present');

if (!updateClient.includes('Linking.openURL')) {
  fail('Play Store must open via Linking fallback');
} else pass('Play Store Linking fallback present');

if (!process.exitCode) {
  console.log('\n[verify-update-resume-policy] ok');
}
