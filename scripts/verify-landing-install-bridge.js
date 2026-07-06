#!/usr/bin/env node
/**
 * Verify landing install bridge wiring in OsmaniTvExpo.
 * Run: node scripts/verify-landing-install-bridge.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}
function pass(msg) {
  console.log('PASS', msg);
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function assertContains(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) fail(`${label}: missing ${needle} in ${rel}`);
  else pass(label);
}

assertContains(
  'modules/osmani-update/android/src/main/AndroidManifest.xml',
  'LandingInstallActivity',
  'manifest declares LandingInstallActivity',
);
assertContains(
  'modules/osmani-update/android/src/main/AndroidManifest.xml',
  'osmani-tv-landing.vercel.app',
  'https app link host',
);
assertContains(
  'modules/osmani-update/android/src/main/java/com/osmantv/update/LandingInstallValidator.kt',
  'osmani-tv-apk-download.b-cdn.net',
  'apk host allowlist',
);
assertContains(
  'modules/osmani-update/android/src/main/java/com/osmantv/update/ApkInstaller.kt',
  'FLAG_GRANT_READ_URI_PERMISSION',
  'installer intent flags',
);
assertContains('App.js', 'landingInstallBridge', 'App wires warm-start bridge');
assertContains('modules/osmani-update/index.ts', 'handleLandingInstallLink', 'JS export');

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nverify-landing-install-bridge: ok');
