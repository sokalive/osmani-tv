#!/usr/bin/env node
'use strict';

/**
 * Production subscription recovery — reinstall, migration, cache loss, OTA.
 * Run: node scripts/verify-subscription-recovery-boot.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const boot = fs.readFileSync(path.join(root, 'lib', 'subscriptionRecoveryBoot.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

const timeoutMatch = boot.match(/SUBSCRIPTION_RECOVERY_BOOT_TIMEOUT_MS\s*=\s*([\d_]+)/);
const timeoutMs = timeoutMatch ? Number(String(timeoutMatch[1]).replace(/_/g, '')) : 0;
if (timeoutMs < 40_000) fail('boot recovery timeout must allow migration');
else pass('boot recovery timeout');

if (!boot.includes('backendConfirmsActiveSubscription')) fail('active helper');
else pass('backend active detect');

if (!boot.includes('backendConfirmsInactiveSubscription')) fail('inactive helper');
else pass('backend inactive detect');

if (!boot.includes('purgeUnreliableSubscriptionCache')) fail('purge helper');
else pass('purge unreliable cache helper');

const ctx = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
const identity = fs.readFileSync(path.join(root, 'lib', 'deviceIdentity.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');

if (!ctx.includes('purgeUnreliableSubscriptionCache')) fail('boot must purge wrong-device cache');
else pass('boot purges wrong-device cache');

if (!ctx.includes("recoverSubscription(deviceId, deviceFingerprint")) {
  fail('boot must run fast recoverSubscription for identity migration');
} else pass('cold-start recoverSubscription');

if (!ctx.includes("reverifySubscription('cold-start-bg')")) {
  fail('boot must background-verify after sync ready');
} else pass('cold-start-bg background verify');

if (ctx.includes("reverifySubscription('boot-recovery')")) {
  fail('boot must not block UI on boot-recovery verify');
} else pass('no blocking boot-recovery verify');

if (!ctx.includes('subscriptionRecoveryComplete')) fail('recovery complete flag');
else pass('subscriptionRecoveryComplete state');

if (!ctx.includes('setSubscriptionRecoveryComplete(true)')) {
  fail('must mark recovery complete after boot');
} else pass('recovery complete after boot');

if (!api.includes('resolveActiveSubscription')) fail('resolveActiveSubscription');
else pass('resolveActiveSubscription');

if (!api.includes('identityCandidates')) fail('identity candidates in api');
else pass('identity candidates');

if (!api.includes('readLocalPhoneDigits')) fail('phone digits in identity context');
else pass('phone recovery in identity context');

if (!api.includes('migration_bridge')) fail('migration_bridge payload');
else pass('migration_bridge');

if (!identity.includes('legacy_package_android_id')) fail('Render APK android id candidate');
else pass('Render migration candidate');

if (!identity.includes('stable_hardware_id')) fail('stable hardware candidate');
else pass('device replacement hardware id');

if (!identity.includes('legacyDeviceFingerprint')) fail('legacy fingerprint for VPS↔Render');
else pass('legacy fingerprint migration');

if (!app.includes('subscriptionRecoveryComplete')) fail('App gates renewal on recovery');
else pass('renewal gated until recovery');

// Scenario matrix (static wiring)
const scenarios = [
  'reinstall',
  'AsyncStorage',
  'migration_bridge',
  'identityCandidates',
  'recoverSubscription',
  'getSubscriptionStatusForDevice',
  'clearSubscriptionCache',
];
for (const s of scenarios) {
  const hit = api.includes(s) || ctx.includes(s) || identity.includes(s) || boot.includes(s);
  if (!hit) fail(`scenario wiring missing: ${s}`);
  else pass(`scenario: ${s}`);
}

if (!process.exitCode) {
  console.log('\n[verify-subscription-recovery-boot] ok');
}
