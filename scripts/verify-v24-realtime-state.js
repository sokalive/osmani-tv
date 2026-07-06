#!/usr/bin/env node
'use strict';

/**
 * v24 VPS-first realtime state — revoke/grant/channel flicker guards.
 * Run: node scripts/verify-v24-realtime-state.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

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

const ctx = read('context/OsmaniAppContext.jsx');
const guard = read('lib/subscriptionSseGuard.js');
const reconcile = read('lib/subscriptionReconcile.js');
const subApi = read('api/subscription.js');
const devStream = read('lib/subscriptionDeviceStream.js');
const adminSse = read('lib/adminSseRefreshEvents.js');
const app = read('App.js');
const nav = read('lib/premiumChannelNavigation.js');
const player = read('screens/ChannelPlayerScreen.js');
const vps = read('lib/playVpsApiHost.js');

if (!reconcile.includes('isAuthoritativeReconcileReason')) fail('reconcile reason helper');
else pass('reconcile reason helper');

if (!ctx.includes('skipFastProbe: authoritativeReconcile')) fail('skip fast probe on reconcile');
else pass('skip fast probe on reconcile');

if (!ctx.includes('!authoritativeReconcile')) fail('skip preserve on reconcile');
else pass('skip preserve on reconcile');

if (!ctx.includes('pre-reconcile:')) fail('pre-clear cache on revoke reconcile');
else pass('pre-clear cache on revoke');

if (!ctx.includes('optimistic_clear')) fail('optimistic clear on matched revoke SSE');
else pass('optimistic clear on revoke SSE');

const revokedStart = ctx.indexOf("const offRevoked = subscribeRealtimeEvent('subscription_revoked'");
const revokedEnd = ctx.indexOf('const offSubscriptionLifecycle', revokedStart);
const revokedBlock = ctx.slice(revokedStart, revokedEnd);
if (revokedBlock.includes("role === 'none'")) {
  fail('revoke SSE must not ignore missing device_id broadcasts');
} else pass('revoke SSE allows global broadcast');

if (!guard.includes('isExplicitRevokedConfirmation(verifyResult)) return null')) {
  fail('admin revoke must not show expiry modal');
} else pass('silent admin revoke modal');

if (!devStream.includes('subscription_revoked')) fail('device stream listens for revoke');
else pass('device stream revoke listener');

if (!devStream.includes('entitlement_changed')) fail('device stream entitlement_changed');
else pass('device stream entitlement_changed');

if (!adminSse.includes('entitlement_changed')) fail('wake events include entitlement_changed');
else pass('entitlement_changed in wake events');

if (!subApi.includes('skipFastProbe')) fail('resolveActiveSubscription skipFastProbe option');
else pass('resolveActiveSubscription skipFastProbe');

if (!ctx.includes('catalogAccessReady')) fail('catalogAccessReady exported');
else pass('catalogAccessReady state');

if (!app.includes('catalogAccessReady')) fail('App uses catalogAccessReady for badges');
else pass('App badge gate on catalogAccessReady');

if (!app.includes('findRawChannelById')) fail('App rebuilds channel at tap');
else pass('App fresh channel at tap');

if (nav.includes('&& cardIsPremium')) fail('premium nav must not use stale cardIsPremium');
else pass('premium nav uses player channel access only');

if (!player.includes('accessType')) fail('player syncs access fields');
else pass('player access field sync');

if (!vps.includes('api.osmanitv.com')) fail('VPS host');
else pass('VPS api.osmanitv.com');

if (!ctx.includes('CHANNEL_ACCESS_IMMEDIATE_SSE_EVENTS')) fail('immediate channel SSE refresh');
else pass('immediate channel SSE refresh');

if (!ctx.includes('lastActivationSuccessKeyRef')) fail('Hongera dedup ref');
else pass('Hongera dedup');

if (process.exitCode) process.exit(1);
console.log('\n[verify-v24-realtime-state] ok');
