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

const { normalizeInternationalPhone, isValidInternationalPhone } = require('../lib/internationalPhone');

const cases = [
  ['+255712345678', true],
  ['255712345678', true],
  ['0712345678', true],
  ['+12025550123', true],
  ['12025550123', true],
  ['+447911123456', true],
  ['447911123456', true],
  ['', false],
  ['abc', false],
  ['123', false],
];

for (const [input, expect] of cases) {
  const ok = isValidInternationalPhone(input);
  if (ok !== expect) fail(`phone ${JSON.stringify(input)} expected ${expect}`);
  else pass(`phone ${JSON.stringify(input)}`);
}

const tz = normalizeInternationalPhone('0712345678');
if (!tz || !tz.digits.startsWith('255')) fail('TZ local normalize');
else pass('TZ local normalize');

const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
if (!app.includes('PhoneNumberGate')) fail('App wires PhoneNumberGate');
else pass('App wires PhoneNumberGate');

const gate = fs.readFileSync(path.join(root, 'components/PhoneNumberGate.jsx'), 'utf8');
if (!gate.includes('Inakagua nambari ya simu')) fail('checking message');
else pass('checking message');
if (!gate.includes('Inahifadhi nambari ya simu')) fail('saving message');
else pass('saving message');

const api = fs.readFileSync(path.join(root, 'api/deviceProfile.js'), 'utf8');
if (!api.includes('/api/device/profile')) fail('profile endpoint');
else pass('profile endpoint');
if (!api.includes('/api/device/phone')) fail('save endpoint');
else pass('save endpoint');

if (!process.exitCode) console.log('\n[verify-phone-number-gate] ok');
