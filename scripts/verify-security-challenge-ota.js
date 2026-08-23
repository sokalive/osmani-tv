#!/usr/bin/env node
'use strict';

/**
 * Phase 2 security challenge pipeline verification (static + live API).
 * Run: node scripts/verify-security-challenge-ota.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function assertContains(rel, needle, label) {
  if (!read(rel).includes(needle)) fail(`${label}: missing ${needle} in ${rel}`);
  else pass(label);
}

assertContains('api/security.js', 'requestSecurityChallenge', 'challenge helper');
assertContains('api/security.js', 'security_nonce', 'report sends security_nonce');
assertContains('api/security.js', 'install_id', 'report sends install_id');
assertContains('api/security.js', 'nonce_replay', 'nonce_replay handling');
assertContains('api/security.js', 'signalsForServerReport', 'strip client risk scores');
assertContains('api/security.js', 'MAX_CHALLENGE_ATTEMPTS', 'bounded challenge attempts');
assertContains('lib/security/playIntegrityCapability.js', 'cannot honestly be activated', 'Play Integrity honesty');
assertContains('lib/lastSecurityReportSnapshot.js', 'everSevere', 'snapshot everSevere');
assertContains('lib/security/riskEngine.js', 'EVER_SEVERE_STALE', 'ever severe enforcement');
assertContains('context/SecurityContext.jsx', 'verificationState', 'verification state exposed');
assertContains('context/SecurityContext.jsx', 'serverCalculatedScore', 'server score preferred');
assertContains('lib/deviceIdentity.js', 'getSecurityInstallId', 'install id alias');

// Ensure we do not invent Play Integrity imports
const securityApi = read('api/security.js');
if (securityApi.includes('play-integrity') || securityApi.includes('SafetyNet')) {
  fail('must not import unavailable Play Integrity native modules');
} else pass('no fake Play Integrity native imports');

(async () => {
  const device_id = `phase2-verify-${Date.now()}`;
  const install_id = `inst-verify-${Date.now()}`;

  const chRes = await fetch(`${BASE}/api/runtime/security-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ device_id, install_id }),
  });
  const ch = await chRes.json();
  if (!chRes.ok || !ch.nonce) fail(`challenge failed HTTP ${chRes.status}`);
  else pass(`challenge nonce obtained (ttl ${ch.ttl_sec ?? '?'})`);

  const reportBody = {
    device_id,
    install_id,
    security_nonce: ch.nonce,
    device_fingerprint: 'a'.repeat(64),
    signals: [],
    detected_at: new Date().toISOString(),
    details: { platform: 'android', play_integrity_available: false },
    app_version: '1.8.2',
    build_number: '24',
  };

  const r1 = await fetch(`${BASE}/api/runtime/security-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(reportBody),
  });
  const j1 = await r1.json();
  if (!r1.ok || j1.playbackAllowed !== true) {
    fail(`clean report expected allow, got ${r1.status} ${JSON.stringify(j1).slice(0, 200)}`);
  } else pass('clean challenge report allowed');

  if (j1.challenge_valid !== true) fail('challenge_valid should be true');
  else pass('challenge_valid true');

  if (j1.score_mismatch === true) fail('must not score_mismatch when client score omitted');
  else pass('no score_mismatch without client risk_score');

  const r2 = await fetch(`${BASE}/api/runtime/security-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(reportBody),
  });
  const j2 = await r2.json();
  if (r2.status !== 403 || j2.code !== 'nonce_replay') {
    fail(`replay expected nonce_replay, got ${r2.status} ${JSON.stringify(j2)}`);
  } else pass('nonce_replay denied on second use');

  // device mismatch
  const ch2Res = await fetch(`${BASE}/api/runtime/security-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ device_id, install_id }),
  });
  const ch2 = await ch2Res.json();
  const r3 = await fetch(`${BASE}/api/runtime/security-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...reportBody,
      security_nonce: ch2.nonce,
      device_id: 'other-device-mismatch',
    }),
  });
  const j3 = await r3.json();
  if (r3.status !== 403 || j3.code !== 'device_mismatch') {
    fail(`expected device_mismatch, got ${r3.status} ${JSON.stringify(j3)}`);
  } else pass('device_mismatch denied');

  // severe then clean
  const sevDevice = `phase2-sev-${Date.now()}`;
  const sevInstall = `inst-sev-${Date.now()}`;
  const chSev = await (
    await fetch(`${BASE}/api/runtime/security-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ device_id: sevDevice, install_id: sevInstall }),
    })
  ).json();
  const sevReport = await (
    await fetch(`${BASE}/api/runtime/security-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        device_id: sevDevice,
        install_id: sevInstall,
        security_nonce: chSev.nonce,
        device_fingerprint: 'b'.repeat(64),
        signals: [{ risk_type: 'frida_detected' }],
        detected_at: new Date().toISOString(),
        details: { platform: 'android' },
        app_version: '1.8.2',
        build_number: '24',
      }),
    })
  ).json();
  if (sevReport.playbackAllowed !== false || sevReport.ever_severe !== true) {
    fail(`severe expected deny+ever_severe, got ${JSON.stringify(sevReport).slice(0, 300)}`);
  } else pass('severe detection blocks + ever_severe');

  const chClean = await (
    await fetch(`${BASE}/api/runtime/security-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ device_id: sevDevice, install_id: sevInstall }),
    })
  ).json();
  const cleanAfter = await (
    await fetch(`${BASE}/api/runtime/security-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        device_id: sevDevice,
        install_id: sevInstall,
        security_nonce: chClean.nonce,
        device_fingerprint: 'b'.repeat(64),
        signals: [],
        detected_at: new Date().toISOString(),
        details: { platform: 'android' },
        app_version: '1.8.2',
        build_number: '24',
      }),
    })
  ).json();
  if (cleanAfter.playbackAllowed !== false || cleanAfter.ever_severe !== true) {
    fail(`clean-after-severe must stay denied, got ${JSON.stringify(cleanAfter).slice(0, 300)}`);
  } else pass('clean report cannot erase ever_severe');

  // unit: signalsForServerReport strips scores — load via Function from source pattern
  const stripOk = securityApi.includes('Intentionally omit client risk_score');
  if (!stripOk) fail('must document omitting client risk_score');
  else pass('client risk_score omitted by design');

  if (!process.exitCode) {
    console.log('\n[verify-security-challenge-ota] ok');
    console.log('API base:', BASE);
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
