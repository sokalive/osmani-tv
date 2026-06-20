#!/usr/bin/env node
'use strict';

/**
 * Static checks: update popup must recheck on launch/resume without snooze timers.
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
} else pass('app-resume schedules immediate check');

if (!updateClient.includes('reassertSoftOverlayVisibility')) {
  fail('resume must reassert soft overlay visibility');
} else pass('resume reasserts soft overlay');

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
