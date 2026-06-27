#!/usr/bin/env node
'use strict';

/**
 * Push notification registration repair — v16–v24 compatibility.
 * Run: node scripts/verify-push-notification-registration.js
 */

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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const oneSignalNative = read('lib/oneSignal.native.js');
const pushRegNative = read('lib/oneSignalPushRegistration.native.js');
const appJs = read('App.js');
const payload = read('lib/deviceIntelligencePayload.js');
const appConfig = read('app.config.js');

if (!oneSignalNative.includes('ensureOneSignalPushRegistration')) {
  fail('oneSignal.native.js must call ensureOneSignalPushRegistration');
} else {
  pass('startup registration repair wired');
}

if (!pushRegNative.includes('OneSignal.login')) {
  fail('push registration must link device_id via OneSignal.login');
} else {
  pass('OneSignal.login(deviceId) present');
}

if (!pushRegNative.includes('pushSubscription.optIn')) {
  fail('push registration must call optIn when permission granted');
} else {
  pass('optIn repair present');
}

if (!pushRegNative.includes('[PUSH_REG]')) {
  fail('push registration must log [PUSH_REG] proof');
} else {
  pass('logcat registration proof');
}

if (oneSignalNative.includes('foregroundWillDisplay.parse-error')) {
  pass('foreground display errors logged (image-safe)');
} else {
  fail('foreground handler must log display errors');
}

if (!oneSignalNative.includes('foregroundWillDisplay.display-error')) {
  fail('foreground handler must not silently swallow display failures');
} else {
  pass('foreground display failure handling');
}

if (!appJs.includes("ensureOneSignalPushRegistration('app-resume')")) {
  fail('App must re-register push on app resume');
} else {
  pass('app-resume registration repair');
}

if (!payload.includes('push_subscription_id') || !payload.includes('collectOneSignalPushSnapshot')) {
  fail('device intelligence payload must include push snapshot');
} else {
  pass('backend registration includes push proof fields');
}

const appId = '6a3f9dc9-96e9-402a-90e9-9dd829b212b2';
if (!appConfig.includes(appId)) {
  fail('single OneSignal App ID must be in app.config.js');
} else {
  pass('v16–v24 share same OneSignal App ID');
}

if (read('components/NotificationPermissionReminderGate.jsx').includes('ensureOneSignalPushRegistration')) {
  pass('permission gate triggers registration repair');
} else {
  fail('permission reminder must repair registration after allow');
}

const adminStore = fs.readFileSync(
  path.join(root, '..', 'osmani-admin', 'server', 'src', 'lib', 'deviceIntelligenceStore.js'),
  'utf8',
);
if (!adminStore.includes('push_subscription_id') || !adminStore.includes('mergeRegistryMetadata')) {
  fail('admin must persist push metadata on register heartbeat');
} else {
  pass('admin stores push metadata for visibility');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\n[verify-push-notification-registration] ok');
