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

if (!script.includes('worktree')) fail('rollback must use git worktree (main unchanged)');
else pass('git worktree isolates v24 main');

console.log('\nBad OTA (crash): fe01ce77-d367-4ccd-ad24-7ecd188758ce @ 6018896');
console.log('Stable restore:  f7cb49b (VPS migration, pre-QA hydrate crash)');

if (!process.exitCode) console.log('\n[verify-rollback-ota-1.8.0] ok');
