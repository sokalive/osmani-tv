#!/usr/bin/env node
'use strict';

/**
 * Reinstall persistence — compare stable v16–v20 behavior wiring.
 * Run: node scripts/verify-reinstall-subscription-recovery.js
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

const ctx = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
const identity = fs.readFileSync(path.join(root, 'lib', 'deviceIdentity.js'), 'utf8');

// Historical stable chain: fast status → candidates → recover per candidate → refresh after ok
if (!api.includes('fastStatusProbe')) fail('fast status probe for SSAID');
else pass('fast status probe');

if (!api.includes('refreshSubscriptionAfterRecover')) fail('recover ok → verify refresh');
else pass('recover ok refresh chain');

if (!ctx.includes('resolveActiveSubscription(identity)')) fail('cold-start uses full resolve chain');
else pass('cold-start resolveActiveSubscription');

if (!ctx.includes('reverifySubscription(\'cold-start-bg\')')) fail('background verify after sync ready');
else pass('non-blocking background verify');

if (ctx.includes("reverifySubscription('boot-recovery')")) {
  fail('must not block UI on boot-recovery verify');
} else pass('no blocking boot-recovery');

if (!ctx.includes('setSubscriptionSyncLoaded(true)')) fail('sync ready before long verify');
else pass('sync ready before background verify');

if (!identity.includes('package_android_id')) fail('SSAID identity candidate');
else pass('SSAID survives reinstall');

if (!api.includes('getSubscriptionStatusForDevice')) fail('status fallback for transport timeout');
else pass('status transport fallback');

if (!process.exitCode) {
  console.log('\n[verify-reinstall-subscription-recovery] ok');
}
