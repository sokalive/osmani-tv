#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

const account = fs.readFileSync(path.join(root, 'screens/AkauntiYanguScreen.js'), 'utf8');
const updateLib = fs.readFileSync(path.join(root, 'lib/accountAppUpdate.js'), 'utf8');

if (!account.includes('runAccountAppUpdate')) fail('account uses runAccountAppUpdate');
else pass('account update handler');

if (!account.includes('UPDATE APP')) fail('UPDATE APP button');
else pass('UPDATE APP button');

if (!updateLib.includes('ACCOUNT_UPDATE_ALREADY_LATEST_SWAHILI')) fail('already latest copy');
else pass('already latest copy');

if (!updateLib.includes('forceRecheck')) fail('reuses forceRecheck');
else pass('reuses forceRecheck');

if (!updateLib.includes('startDownload')) fail('reuses startDownload');
else pass('reuses startDownload');

if (!account.includes('isBlockingSheetActive')) fail('defers when blocking sheet active');
else pass('modal defer on blocking sheet');

if (!process.exitCode) console.log('\n[verify-account-app-update] ok');
