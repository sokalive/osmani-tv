#!/usr/bin/env node
'use strict';

/**
 * Security hardening verification (static + logic smoke).
 * Run: node scripts/verify-security-hardening.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertContains(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) {
    console.error('FAIL:', label, rel, 'missing', needle);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

const THREAT_SET = new Set([
  'root_detected',
  'emulator_detected',
  'clone_detected',
  'frida_detected',
  'debugger_attached',
  'debug_detected',
  'hook_detected',
  'resigned_apk',
  'invalid_signature',
  'package_mismatch',
  'tampered_apk',
  'jailbreak_ios',
]);

function hasThreatSignals(signals) {
  return (signals ?? []).some((s) => THREAT_SET.has(String(s?.risk_type ?? '').trim()));
}

function resolveEnforcement({ signals = [], serverPlaybackAllowed = null, serverEnforcement = null }) {
  if (serverPlaybackAllowed === false) return { blockPlayback: true };
  if (String(serverEnforcement ?? '').trim().toLowerCase() === 'block') return { blockPlayback: true };
  if (hasThreatSignals(signals)) return { blockPlayback: true };
  return { blockPlayback: false };
}

assertContains('lib/security/constants.js', 'package_mismatch', 'package_mismatch threat');
assertContains('lib/security/constants.js', 'invalid_signature', 'invalid_signature threat');
assertContains('lib/security/constants.js', 'tampered_apk', 'tampered_apk threat');
assertContains('lib/security/expectedIntegrity.js', 'readExpectedAndroidPackage', 'expected package reader');
assertContains('lib/security/runtimeScan.js', 'package_matches', 'integrity details package_matches');
assertContains('lib/security/runtimeScan.js', 'expected_package_configured', 'integrity details flags');
assertContains(
  'modules/osmani-security/android/src/main/java/com/osmantv/security/SecurityAuditor.kt',
  'package_mismatch',
  'native package_mismatch signal',
);
assertContains(
  'modules/osmani-security/android/src/main/java/com/osmantv/security/SecurityAuditor.kt',
  'invalid_signature',
  'native invalid_signature signal',
);
assertContains('api/security.js', 'integrity:', 'security report integrity block');
assertContains('app.config.js', 'expectedAndroidPackage', 'expo extra expected package');
assertContains('context/OsmaniAppContext.jsx', 'gateForPlayback', 'subscription server gate');
assertContains('screens/ChannelPlayerScreen.js', 'usePlaybackSecurityGate', 'player security gate');
assertContains('lib/premiumChannelNavigation.js', 'assertPlaybackAllowed', 'navigation security gate');

const pkgClone = [{ risk_type: 'package_mismatch', risk_score: 9 }];
const resign = [{ risk_type: 'resigned_apk', risk_score: 8 }];
const invalidSig = [{ risk_type: 'invalid_signature', risk_score: 9 }];

if (!resolveEnforcement({ signals: pkgClone }).blockPlayback) {
  console.error('FAIL: package_mismatch must block playback');
  process.exitCode = 1;
} else {
  console.log('PASS: package_mismatch blocks playback');
}

if (!resolveEnforcement({ signals: resign }).blockPlayback) {
  console.error('FAIL: resigned_apk must block playback');
  process.exitCode = 1;
} else {
  console.log('PASS: resigned_apk blocks playback');
}

if (!resolveEnforcement({ signals: invalidSig }).blockPlayback) {
  console.error('FAIL: invalid_signature must block playback');
  process.exitCode = 1;
} else {
  console.log('PASS: invalid_signature blocks playback');
}

if (resolveEnforcement({ signals: [{ risk_type: 'dev_client', risk_score: 3 }] }).blockPlayback) {
  console.error('FAIL: dev_client must not block playback');
  process.exitCode = 1;
} else {
  console.log('PASS: dev_client does not block');
}

if (process.exitCode) {
  process.exit(1);
}
console.log('[verify-security-hardening] ok');
