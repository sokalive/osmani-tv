#!/usr/bin/env node
'use strict';

/**
 * Device QA matrix — run on each physical device BEFORE OTA.
 * Prints checklist; operator marks pass/fail manually.
 *
 * Usage: node scripts/device-account-display-matrix.js
 */

const SCENARIOS = [
  { id: 'sonicpesa', label: 'SonicPesa payment' },
  { id: 'admin_grant', label: 'Admin Manual Grant' },
  { id: 'custom_grant', label: 'Custom Grant' },
  { id: 'offer_code', label: 'Offer Code' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'recovery', label: 'Recovery (reinstall / clear data)' },
  { id: 'existing_restart', label: 'Existing active subscriber — cold restart' },
  { id: 'old_sub', label: 'Subscription created before account-card fix' },
  { id: 'new_sub', label: 'New purchase after fix build 5e736b9+' },
];

const DEVICES = [
  { id: 'tecno-bg6', label: 'Tecno BG6 (reported)' },
  { id: 'samsung', label: 'Samsung' },
  { id: 'android-alt', label: 'Additional Android (different OS version)' },
];

const CHECKS = [
  'Malipo / Kifurushi shows package + price (e.g. Wiki 1 · TSh 3,000)',
  'Muda wa Kifurushi shows duration days (e.g. 7)',
  'Remaining days matches backend',
  'Expiry date matches backend',
  'Status ACTIVE',
  'Kill app → reopen — cards still complete',
  'Force-stop → reopen — cards still complete',
  'Phone restart → cards still complete',
  'No "—" on Malipo / Kifurushi or Muda wa Kifurushi',
  '[ACCOUNT_DISPLAY_TRACE] shows mergedPlanName, mergedAmount, mergedPlanDurationDays',
];

console.log('=== Account Display Device Matrix (pre-OTA gate) ===\n');
console.log('Build required: commit 5e736b9 or later (NOT production OTA 764dd7c alone).\n');
console.log('Install via: expo run:android / dev client / internal APK with fix.\n');

for (const device of DEVICES) {
  console.log(`\n## Device: ${device.label}`);
  for (const scenario of SCENARIOS) {
    console.log(`\n  Scenario: ${scenario.label}`);
    for (const check of CHECKS) {
      console.log(`    [ ] ${check}`);
    }
  }
}

console.log('\n=== Log capture ===');
console.log('  adb logcat | findstr ACCOUNT_DISPLAY_TRACE');
console.log('\n=== Production population audit ===');
console.log('  Export active device_id list from Admin → active-devices.txt');
console.log('  DEVICE_IDS_FILE=./active-devices.txt node scripts/audit-account-display-production.js');
console.log('\n=== Gate ===');
console.log('  ALL devices × ALL scenarios PASS → then OTA + VPS deploy\n');
