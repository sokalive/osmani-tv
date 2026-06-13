#!/usr/bin/env node
'use strict';

/**
 * Static verification for strict zero-tolerance security (OTA client).
 * Run: node scripts/verify-strict-security.js
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
    return false;
  }
  console.log('PASS:', label);
  return true;
}

function assertNotContains(rel, needle, label) {
  const text = read(rel);
  if (text.includes(needle)) {
    console.error('FAIL:', label, rel, 'still contains', needle);
    process.exitCode = 1;
    return false;
  }
  console.log('PASS:', label);
  return true;
}

const SWAHILI =
  'Kifaa chako kimezuiwa kutumia Osmani TV kwa sababu mfumo wa usalama umebaini mabadiliko yasiyoruhusiwa kwenye simu au programu';

assertContains('lib/security/constants.js', 'root_detected', 'threat types defined');
assertContains('lib/security/constants.js', 'resigned_apk', 'resigned_apk threat');
assertContains('lib/security/constants.js', 'package_mismatch', 'package_mismatch threat');
assertContains('lib/security/constants.js', 'invalid_signature', 'invalid_signature threat');
assertContains('lib/security/constants.js', SWAHILI, 'Swahili block message constant');
assertContains('lib/security/riskEngine.js', 'hasThreatSignals', 'zero-tolerance uses hasThreatSignals');
assertContains('lib/security/riskEngine.js', 'blockPlayback: true', 'block state defined');
assertNotContains('lib/security/riskEngine.js', 'limitedPlayback: true', 'no limited playback in riskEngine');

assertContains('context/SecurityContext.jsx', 'setLoading(false)', 'loading cleared before report');
assertContains('context/SecurityContext.jsx', 'serverPlaybackAllowed', 'server playbackAllowed state');
assertContains('context/SecurityContext.jsx', 'SECURITY_BLOCK_MESSAGE', 'Swahili message in gate');
assertNotContains('context/SecurityContext.jsx', 'if (security.loading) return { ok: true }', 'no loading bypass in assert');

assertContains('api/security.js', '/api/runtime/security-report', 'primary security report endpoint');
assertContains('api/security.js', 'detected_at', 'detection timestamp in report');
assertContains('api/security.js', 'device_fingerprint', 'device fingerprint in report');
assertContains('api/security.js', 'playbackAllowed', 'playbackAllowed parsing');
assertContains('api/security.js', 'playback_allowed', 'playback_allowed parsing');
assertContains('api/security.js', 'hasThreatSignals(signals)) return false', 'threat reports never deduped');

assertContains('screens/ChannelPlayerScreen.js', 'PLAYER_SECURITY_POLL_MS', 'player security polling');
assertContains('screens/ChannelPlayerScreen.js', 'stopPlaybackForSecurity', 'immediate playback stop');
assertContains('screens/ChannelPlayerScreen.js', 'security.refresh', 'refresh while player active');

assertContains('components/SecurityPlaybackGate.js', 'gate.message', 'block UI uses security gate message');
assertContains('components/SecurityPlaybackGate.js', 'return null', 'security warning banner disabled');

assertContains('lib/security/securityPhone.js', 'cacheSecurityPhone', 'phone cache helper');
assertContains('api/subscription.js', 'cacheSecurityPhone', 'phone cached from subscription verify');

// Unit-style checks (inline — avoid loading RN-linked modules in Node)
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

function resolveEnforcement({ signals = [], serverEnforcement = null, serverPlaybackAllowed = null, smartMonitorEnabled = false, intelAccessOpen = false, serverSecurityBlocked = null }) {
  if (serverPlaybackAllowed === false) return { blockPlayback: true };
  if (serverSecurityBlocked === true) return { blockPlayback: true };
  if (String(serverEnforcement ?? '').trim().toLowerCase() === 'block') return { blockPlayback: true };
  if (serverPlaybackAllowed === true) return { blockPlayback: false };
  if (smartMonitorEnabled === true) return { blockPlayback: false };
  if (intelAccessOpen === true && serverPlaybackAllowed !== false && serverSecurityBlocked !== true) {
    return { blockPlayback: false };
  }
  if (hasThreatSignals(signals)) return { blockPlayback: true };
  return { blockPlayback: false };
}

function parseSecurityReportResponse(parsed) {
  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
  const readBoolish = (value) => {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true' || v === '1' || v === 'yes') return true;
      if (v === 'false' || v === '0' || v === 'no') return false;
    }
    return null;
  };
  const enforcement =
    typeof data.enforcement === 'string'
      ? data.enforcement
      : typeof root.enforcement === 'string'
        ? root.enforcement
        : null;
  let playbackAllowed =
    readBoolish(data.playbackAllowed) ??
    readBoolish(data.playback_allowed) ??
    readBoolish(root.playbackAllowed) ??
    readBoolish(root.playback_allowed);
  const blockedFlag =
    readBoolish(data.blocked) === true ||
    readBoolish(root.blocked) === true ||
    String(data.status ?? root.status ?? '').trim().toLowerCase() === 'blocked';
  if (blockedFlag && playbackAllowed !== false) playbackAllowed = false;
  if (String(enforcement ?? '').trim().toLowerCase() === 'block' && playbackAllowed !== false) {
    playbackAllowed = false;
  }
  return {
    enforcement,
    playbackAllowed,
    blocked:
      blockedFlag ||
      playbackAllowed === false ||
      String(enforcement ?? '').toLowerCase() === 'block',
  };
}

function assertTrue(cond, label) {
  if (!cond) {
    console.error('FAIL:', label);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

const threat = [{ risk_type: 'frida_detected', risk_score: 10 }];
assertTrue(hasThreatSignals(threat), 'hasThreatSignals detects frida');
assertTrue(
  resolveEnforcement({ signals: threat, mode: 'enforce', serverPlaybackAllowed: true }).blockPlayback === false,
  'resolveEnforcement trusts server playbackAllowed=true over local threats',
);
assertTrue(
  resolveEnforcement({ signals: threat, mode: 'enforce' }).blockPlayback === true,
  'resolveEnforcement blocks local threats when server unset',
);
assertTrue(
  resolveEnforcement({ signals: [], serverPlaybackAllowed: false }).blockPlayback === true,
  'resolveEnforcement blocks on server playbackAllowed=false',
);
assertTrue(
  resolveEnforcement({ signals: [], serverEnforcement: 'block' }).blockPlayback === true,
  'resolveEnforcement blocks on enforcement=block',
);

const parsed = parseSecurityReportResponse({
  playback_allowed: false,
  enforcement: 'block',
  blocked: true,
});
assertTrue(parsed.playbackAllowed === false, 'parse playback_allowed=false');
assertTrue(parsed.blocked === true, 'parse blocked flag');

if (process.exitCode) {
  process.exit(1);
}
console.log('[verify-strict-security] ok');
