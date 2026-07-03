#!/usr/bin/env node
'use strict';

/**
 * Static + manual verification checklist for recent Osmani TV app features.
 * Run: node scripts/verify-recent-features.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function fail(msg) {
  console.error('FAIL:', msg);
  failed += 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

require('./verify-account-app-update.js');

const account = read('screens/AkauntiYanguScreen.js');
const updateSection = read('components/UpdateAppSection.js');

if (!account.includes('UpdateAppSection')) fail('AkauntiYangu mounts UpdateAppSection');
else pass('UpdateAppSection in account scroll');

if (account.includes('updateFooter')) {
  fail('must not use pinned footer for update section');
} else pass('no pinned update footer');

if (!updateSection.includes('Update App')) fail('Update App title in component');
else pass('Update App title in component');

if (!updateSection.includes('Pakua toleo jipya la programu ikiwa linapatikana')) {
  fail('Update App Swahili subtitle');
} else pass('Update App subtitle copy');

if (!account.includes('subscriptionVersion')) fail('account clears sticky refs on subscriptionVersion');
else pass('account sticky ref clear on transfer');

try {
  require('./verify-instruction-video-channel.js');
} catch (e) {
  fail(`instruction video verify: ${e.message}`);
}

require('./verify-subscription-sse-guard.js');

const hamisha = read('components/HamishaKifurushiModal.js');
if (!hamisha.includes('isValidTanzaniaMobilePhone')) fail('Hamisha modal phone validation');
else pass('transfer phone validation');

console.log('\n--- Manual device verification (required) ---');
console.log('| Runtime | Screen | versionCode | Expected | Actual |');
console.log('| 1.6.0–1.8.2 | Akaunti Yangu (below offer code) | any | "Update App" + UPDATE APP in scroll | fill after test |');
console.log('| 1.6.0–1.8.2 | Akaunti Yangu tap UPDATE APP | < latest | APK download starts | fill after test |');
console.log('| 1.6.0–1.8.2 | Akaunti Yangu tap UPDATE APP | 24 | already-latest Swahili alert | fill after test |');
console.log('| any | Phone A after transfer approve | — | ACTIVE clears instantly | fill after test |');
console.log('\nSteps:');
console.log('1. Force-close app twice so OTA reloads.');
console.log('2. Open Akaunti Yangu → scroll past offer code — Update App appears directly below.');
console.log('3. Logcat: [ACCOUNT_UPDATE] rendered');
console.log('4. Transfer A→B, approve on A — logcat [SUBSCRIPTION_CLEAR_LOCAL]');

if (failed > 0) {
  console.error(`\n[verify-recent-features] ${failed} failure(s)`);
  process.exit(1);
}
console.log('\n[verify-recent-features] static checks ok');
