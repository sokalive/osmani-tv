#!/usr/bin/env node
'use strict';

/**
 * Static + runtime-config checks for recent Osmani TV app features.
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

// Account update section
require('./verify-account-app-update.js');

const account = read('screens/AkauntiYanguScreen.js');
if (!account.includes("import { getScrollContentBottomPadding }")) {
  fail('AkauntiYanguScreen imports getScrollContentBottomPadding');
} else pass('AkauntiYanguScreen tab bar padding import');

if (!account.includes('Update App')) fail('Update App title');
else pass('Update App title visible in JSX');

if (!account.includes('Pakua toleo jipya la programu ikiwa linapatikana.')) {
  fail('Update App Swahili subtitle with period');
} else pass('Update App subtitle copy');

// Instruction video
require('./verify-instruction-video-channel.js');

// Transfer phone validation
const hamisha = read('components/HamishaKifurushiModal.js');
if (!hamisha.includes('isValidTanzaniaMobilePhone')) fail('Hamisha modal phone validation');
else pass('transfer phone validation');

console.log('\n--- Manual device verification (required) ---');
console.log('1. Open app → Akaunti Yangu → scroll to bottom.');
console.log('2. Expect section "Update App" + blue "UPDATE APP" button.');
console.log('3. On v23 or below with newer catalog: tap → APK download starts.');
console.log('4. On v24 latest: tap → alert "Tayari una toleo jipya..."');
console.log('5. Force OTA reload: kill app, reopen twice (or clear app data once if stuck).');

if (failed > 0) {
  console.error(`\n[verify-recent-features] ${failed} failure(s)`);
  process.exit(1);
}
console.log('\n[verify-recent-features] static checks ok');
