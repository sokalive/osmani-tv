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

if (!account.includes("from '../lib/tabBarLayout'")) {
  fail('AkauntiYanguScreen imports tabBarLayout (required for scroll + Update section)');
} else pass('tabBarLayout import present');

if (!account.includes('getScrollContentBottomPadding')) {
  fail('getScrollContentBottomPadding used for account scroll padding');
} else pass('account scroll bottom padding');

if (!account.includes('testID="account-update-section"')) {
  fail('Update App section testID for device verification');
} else pass('Update App section testID');

if (!account.includes('Update App')) fail('Update App title');
else pass('Update App title visible in JSX');

if (!account.includes('Pakua toleo jipya la programu ikiwa linapatikana.')) {
  fail('Update App Swahili subtitle with period');
} else pass('Update App subtitle copy');

if (account.includes('guardAccountAction(() => void handleAccountAppUpdate()')) {
  fail('Update App must not be gated by device intelligence guard');
} else pass('Update App available to all users');

try {
  require('./verify-instruction-video-channel.js');
} catch (e) {
  fail(`instruction video verify: ${e.message}`);
}

const hamisha = read('components/HamishaKifurushiModal.js');
if (!hamisha.includes('isValidTanzaniaMobilePhone')) fail('Hamisha modal phone validation');
else pass('transfer phone validation');

console.log('\n--- Manual device verification (required) ---');
console.log('| Runtime | Screen | versionCode | Expected | Actual |');
console.log('| 1.6.0–1.8.2 | Akaunti Yangu (scroll bottom) | any | "Update App" + blue UPDATE APP | fill after test |');
console.log('| 1.6.0–1.8.2 | Akaunti Yangu tap UPDATE APP | < latest | APK download starts | fill after test |');
console.log('| 1.6.0–1.8.2 | Akaunti Yangu tap UPDATE APP | 24 (latest) | Swahili already-latest alert | fill after test |');
console.log('\nSteps:');
console.log('1. Force-close app twice (or wait 30s) so OTA reloads.');
console.log('2. Open Akaunti Yangu tab → scroll past offer code to bottom.');
console.log('3. Confirm testID account-update-section (or visible "Update App" card).');
console.log('4. Tap UPDATE APP and note download vs already-latest alert.');

if (failed > 0) {
  console.error(`\n[verify-recent-features] ${failed} failure(s)`);
  process.exit(1);
}
console.log('\n[verify-recent-features] static checks ok');
