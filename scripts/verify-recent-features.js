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

if (account.includes('UpdateAppSection')) fail('AkauntiYangu must not mount UpdateAppSection');
else pass('UpdateAppSection hidden from account scroll');

if (account.includes('OmbaKifurushiSection')) fail('AkauntiYangu must not mount OmbaKifurushiSection');
else pass('OmbaKifurushiSection hidden from account scroll');

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
console.log('| 1.6.0–1.8.2 | Akaunti Yangu scroll | any | Update App + Omba Kifurushi absent | fill after test |');
console.log('| 1.6.0–1.8.2 | Akaunti Yangu | any | Device ID, COPY, offer code, THIBITISHA CODE present | fill after test |');
console.log('| any | Phone A after transfer approve | — | ACTIVE clears instantly | fill after test |');
console.log('\nSteps:');
console.log('1. Force-close app twice so OTA reloads.');
console.log('2. Open Akaunti Yangu → scroll full length — Update App and Omba Kifurushi must not appear.');
console.log('3. Confirm THIBITISHA CODE section ends the scroll (no blank gap below).');
console.log('4. Transfer A→B, approve on A — logcat [SUBSCRIPTION_CLEAR_LOCAL]');

if (failed > 0) {
  console.error(`\n[verify-recent-features] ${failed} failure(s)`);
  process.exit(1);
}
console.log('\n[verify-recent-features] static checks ok');
