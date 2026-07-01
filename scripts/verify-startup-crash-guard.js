#!/usr/bin/env node
'use strict';

/**
 * Startup crash guards — phone gate, missing modules, error boundary.
 * Run: node scripts/verify-startup-crash-guard.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function gitTracked(rel) {
  try {
    execSync(`git cat-file -e HEAD:${rel.replace(/\\/g, '/')}`, {
      cwd: root,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

const requiredModules = [
  'components/UpdateAppSection.js',
  'components/AccountUpdateSectionBoundary.js',
  'lib/parseWhatsappSettings.js',
];

for (const rel of requiredModules) {
  if (!fs.existsSync(path.join(root, rel))) fail(`missing file on disk: ${rel}`);
  else pass(`file exists: ${rel}`);
}

const account = read('screens/AkauntiYanguScreen.js');
for (const rel of requiredModules.slice(0, 2)) {
  const base = path.basename(rel, '.js');
  if (!account.includes(base)) fail(`AkauntiYangu must import ${base}`);
  else pass(`AkauntiYangu imports ${base}`);
}

const deviceProfile = read('api/deviceProfile.js');
if (!deviceProfile.includes('identity_failed')) fail('fetchDevicePhoneProfile must catch identity errors');
else pass('fetchDevicePhoneProfile identity guard');

const gate = read('components/PhoneNumberGate.jsx');
if (!gate.includes('check_unhandled')) fail('PhoneNumberGate must catch check errors');
else pass('PhoneNumberGate check guard');

if (gate.includes('phase === \'checking\'')) {
  fail('PhoneNumberGate must not block on checking phase UI');
} else pass('no phone checking phase UI');

const app = read('App.js');
if (!app.includes('StartupErrorBoundary')) fail('App must wrap StartupErrorBoundary');
else pass('StartupErrorBoundary wired');

if (!app.includes('unhandled_rejection')) fail('App must log unhandled rejections');
else pass('unhandled rejection logger');

const catalogStart = app.indexOf('function ChannelCatalogScreen');
const catalogEnd = app.indexOf('function GlobalEmergencyGate');
const catalogBody = app.slice(catalogStart, catalogEnd);
const destructureMatch = catalogBody.match(/const \{([^}]+)\} = useOsmaniApp\(\)/);
if (!destructureMatch) fail('ChannelCatalogScreen must destructure useOsmaniApp');
else {
  const destructured = destructureMatch[1];
  if (catalogBody.includes('premiumPlaybackReady') && !destructured.includes('premiumPlaybackReady')) {
    fail('ChannelCatalogScreen uses premiumPlaybackReady but does not destructure it from useOsmaniApp');
  } else pass('ChannelCatalogScreen premiumPlaybackReady destructured');
}

if (!fs.existsSync(path.join(root, 'lib/startupStepLog.js'))) {
  fail('lib/startupStepLog.js missing');
} else pass('startup step logger exists');

const wa = read('api/whatsappSettings.js');
if (wa.includes('throw new Error') && wa.includes('Could not load WhatsApp')) {
  fail('whatsapp settings viewer must not throw on fetch failure');
} else pass('whatsapp settings fail-soft');

if (!process.exitCode) {
  console.log('\n[verify-startup-crash-guard] ok');
}
