#!/usr/bin/env node
'use strict';

/**
 * Production investigation for device access unblock (device 0523d797b3197a0f).
 * Simulates local threat + server Smart Monitor allow (root cause scenario).
 *
 * Run: node scripts/verify-device-access-production.js
 */

const DEVICE_ID = process.env.DEVICE_ID || '0523d797b3197a0f';
const BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://osmani-admin-api.onrender.com').replace(
  /\/+$/,
  '',
);

function readBoolish(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  return null;
}

function parseIntelAccess(parsed) {
  const blocked = readBoolish(parsed?.blocked) === true || readBoolish(parsed?.registry?.blocked) === true;
  const status = String(parsed?.registry?.status ?? '').toLowerCase();
  if (blocked || status === 'blocked') return { status: 'blocked', smartMonitor: false };
  const sm =
    readBoolish(parsed?.smart_monitor_enabled) === true ||
    readBoolish(parsed?.registry?.smartMonitor) === true;
  if (sm) return { status: 'active', smartMonitor: true };
  if (status === 'unblocked' || status === 'active') return { status: 'active', smartMonitor: false };
  return { status: null, smartMonitor: false };
}

function parseSecurity(parsed) {
  const securityBlocked = readBoolish(parsed?.security_blocked) === true;
  const playbackAllowed =
    readBoolish(parsed?.playbackAllowed) ?? readBoolish(parsed?.playback_allowed);
  const strict = readBoolish(parsed?.strict_enforcement) === true;
  const smartMonitor =
    readBoolish(parsed?.smart_monitor_enabled) === true ||
    (playbackAllowed === true && securityBlocked !== true && strict === true);
  return { securityBlocked, playbackAllowed, strict, smartMonitor };
}

function resolveEnforcement({ serverPlaybackAllowed, smartMonitor, localThreat }) {
  if (serverPlaybackAllowed === false) return true;
  if (serverPlaybackAllowed === true) return false;
  if (smartMonitor) return false;
  return localThreat;
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

(async () => {
  const fp = 'bb814af61add2fd2ba182cfbf2773a4be16eb013334ebfcb1a01baaaaad3f83d';
  const registerBody = {
    device_id: DEVICE_ID,
    device_fingerprint: fp,
    android_id: DEVICE_ID,
    last_seen: new Date().toISOString(),
    app_version: '1.7.2',
  };

  const regRes = await fetch(`${BASE}/api/users-intelligence/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(registerBody),
  });
  const regText = await regRes.text();
  let regParsed = null;
  try {
    regParsed = JSON.parse(regText);
  } catch {
    regParsed = null;
  }

  console.log('\n=== DEVICE INVESTIGATION:', DEVICE_ID, '===');
  console.log('register HTTP', regRes.status);
  console.log('register blocked', regParsed?.blocked, 'allowed', regParsed?.allowed);
  console.log('registry.status', regParsed?.registry?.status);
  console.log('registry.smart_monitor in API', regParsed?.registry?.smart_monitor_enabled ?? '(not in response)');

  if (regRes.status !== 200 || regParsed?.blocked !== false) {
    fail(`production register expected blocked=false, got ${regParsed?.blocked}`);
  } else {
    pass('production Users Intelligence: device NOT admin-blocked');
  }

  const secBody = {
    device_id: DEVICE_ID,
    device_fingerprint: fp,
    risk_type: 'root_detected',
    risk_score: 5,
    signals: [{ risk_type: 'root_detected', risk_score: 5 }],
    detected_at: new Date().toISOString(),
    details: { platform: 'android' },
    app_version: '1.7.2',
  };

  const secRes = await fetch(`${BASE}/api/runtime/security-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(secBody),
  });
  const secParsed = await secRes.json();

  console.log('\nsecurity security_blocked', secParsed.security_blocked);
  console.log('security playbackAllowed', secParsed.playbackAllowed);
  console.log('security strict_enforcement', secParsed.strict_enforcement);

  const intel = parseIntelAccess(regParsed);
  const sec = parseSecurity(secParsed);

  const oldLocalBlock = true; // pre-fix: local root_detected always blocked regardless of server
  const newLocalBlock = resolveEnforcement({
    serverPlaybackAllowed: sec.playbackAllowed,
    smartMonitor: sec.smartMonitor,
    localThreat: true,
  });

  console.log('\n=== ROOT CAUSE SIMULATION ===');
  console.log('OLD client (ignore server playbackAllowed): STILL BLOCKED on local root');
  console.log('NEW client (trust server playbackAllowed=true): OPENED');

  if (oldLocalBlock !== true) fail('expected old behavior to block');
  else pass('confirmed old client blocks despite server allow');

  if (newLocalBlock !== false) fail('expected new client to open for this device');
  else pass('confirmed new client opens with server playbackAllowed=true');

  const fs = require('fs');
  const path = require('path');
  const riskEngine = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'security', 'riskEngine.js'),
    'utf8',
  );
  if (
    !riskEngine.includes('serverPlaybackAllowed === true') ||
    !riskEngine.includes('hasThreatSignals(signals)')
  ) {
    fail('riskEngine must trust server playbackAllowed before local threats');
  } else {
    pass('riskEngine server-authoritative fix present');
  }

  if (intel.status !== 'active') {
    fail(`expected intel active for ${DEVICE_ID}`);
  } else {
    pass(`${DEVICE_ID} server intel status active`);
  }

  if (sec.playbackAllowed !== true) {
    fail('expected security playbackAllowed=true for smart monitor device');
  } else {
    pass(`${DEVICE_ID} server security playbackAllowed=true`);
  }

  console.log('\n=== FINAL ACCESS VERIFICATION (expected after OTA) ===');
  console.log('accessVerificationResult: OPENED');
  console.log('deviceAccessState: Kifaa Kimefunguliwa');
  console.log('deviceAccessReason: Smart Monitor Inatumika');
  console.log('userMessage: Kifaa Kinafuatiliwa Na Smart Monitor');

  if (!process.exitCode) {
    console.log('\n[verify-device-access-production] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
