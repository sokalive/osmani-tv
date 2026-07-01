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
if (gate.includes('Inakagua nambari ya simu')) {
  fail('phone gate must not show blocking check loading message');
} else pass('no blocking phone check loading message');
if (!gate.includes('runProfileCheck')) fail('background profile check');
else pass('background profile check');
if (!gate.includes('<Modal')) fail('phone capture must use modal over Home');
else pass('phone capture modal');
if (!gate.includes('return children') && !gate.includes('{children}')) {
  fail('phone gate must always render children');
} else pass('children always rendered');

const api = fs.readFileSync(path.join(root, 'api/deviceProfile.js'), 'utf8');
if (!api.includes('/api/device/profile')) fail('profile endpoint');
else pass('profile endpoint');
if (!gate.includes('phoneNumberGateEnabled')) fail('gate reads context phoneNumberGateEnabled');
else pass('gate reads context flag');

if (!gate.includes('phoneGateEnabled')) fail('gate reads profile phoneGateEnabled');
else pass('gate reads profile flag');

if (!gate.includes('phone_gate_changed')) fail('gate listens phone_gate SSE');
else pass('gate listens phone_gate SSE');

const settings = fs.readFileSync(path.join(root, 'api/settings.js'), 'utf8');
if (!settings.includes('phoneNumberGateEnabled')) fail('settings parses phone gate flag');
else pass('settings parses phone gate flag');

const ctx = fs.readFileSync(path.join(root, 'context/OsmaniAppContext.jsx'), 'utf8');
if (!ctx.includes('phoneNumberGateEnabled')) fail('context exposes phoneNumberGateEnabled');
else pass('context exposes phoneNumberGateEnabled');

if (!process.exitCode) console.log('\n[verify-phone-number-gate] ok');
