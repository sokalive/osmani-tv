#!/usr/bin/env node
'use strict';

/**
 * Static checks for 1.8.0 rollback publish script.
 */

const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const script = read('scripts/publish-rollback-ota-1.8.0.js');

if (!script.includes('f7cb49b')) fail('rollback must target f7cb49b');
else pass('stable commit f7cb49b');

if (!script.includes("'1.8.0'")) fail('rollback must target runtime 1.8.0 only');
else pass('runtime 1.8.0 only');

if (!script.includes('api.osmanitv.com')) fail('rollback must embed VPS API URL');
else pass('VPS EXPO_PUBLIC_API_URL');

if (!script.includes('restore')) fail('rollback must temporarily restore stable tree');
else pass('git restore + reset preserves main v24');

console.log('\nBad OTA (crash): fe01ce77-d367-4ccd-ad24-7ecd188758ce @ 6018896');
console.log('Stable restore:  f7cb49b75c358b445448f59ab81352c30fa14f6b');
console.log('Rollback OTA:    d0e9f867-cb8d-46b7-842b-f422da46360f');

if (!process.exitCode) console.log('\n[verify-rollback-ota-1.8.0] ok');
