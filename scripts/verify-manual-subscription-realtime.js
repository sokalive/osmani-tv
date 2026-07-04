#!/usr/bin/env node
'use strict';

/**
 * Manual subscription instant delivery — contract + wiring verification.
 * Run: node scripts/verify-manual-subscription-realtime.js
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

const admin = fs.readFileSync(path.join(root, 'lib/adminSseRefreshEvents.js'), 'utf8');
const ctx = fs.readFileSync(path.join(root, 'context/OsmaniAppContext.jsx'), 'utf8');
const stream = fs.readFileSync(path.join(root, 'lib/subscriptionDeviceStream.js'), 'utf8');
const realtime = fs.readFileSync(path.join(root, 'lib/realtimeSync.js'), 'utf8');
const instant = fs.readFileSync(path.join(root, 'lib/subscriptionSseInstant.js'), 'utf8');
const contract = JSON.parse(
  fs.readFileSync(path.join(root, 'manual-subscription-realtime-contract.json'), 'utf8'),
);

const requiredAliases = [
  'device_subscription',
  'device_subscription_granted',
  'manual_subscription_granted',
  'package_granted',
  'manual_gift',
  'subscription_wake',
  'subscription_manual_grant',
];

for (const alias of requiredAliases) {
  if (!admin.includes(`'${alias}'`)) fail(`missing SSE alias ${alias}`);
  else pass(`SSE alias registered: ${alias}`);
}

if (!admin.includes('SUBSCRIPTION_WAKE_SSE_EVENTS')) fail('SUBSCRIPTION_WAKE_SSE_EVENTS export');
else pass('SUBSCRIPTION_WAKE_SSE_EVENTS export');

if (!stream.includes('subscription-stream')) fail('device stream must target /api/subscription-stream');
else pass('persistent subscription-stream module');

if (!ctx.includes('startSubscriptionDeviceStream')) fail('context must start device stream');
else pass('context wires device stream');

if (!ctx.includes('SUBSCRIPTION_WAKE_SSE_EVENTS')) fail('context must listen to wake events');
else pass('context SUBSCRIPTION_WAKE_SSE_EVENTS listeners');

if (!ctx.includes('__sync_stream_connected')) fail('context must reverify on sync reconnect');
else pass('sync stream reconnect reverify');

if (!ctx.includes("reverifySubscription(reason)")) fail('device stream must call reverifySubscription');
else pass('device stream triggers authoritative verify');

if (!realtime.includes('SUBSCRIPTION_WAKE_SSE_EVENTS')) fail('realtimeSync must register wake events');
else pass('realtimeSync wake event whitelist');

if (!instant.includes('sseGrantTargetsThisDevice')) fail('device targeting guard required');
else pass('SSE device targeting guard');

if (ctx.includes('reverifySubscription(`sse:${ev}`)')) pass('sync stream events trigger reverify');
else fail('sync stream must trigger reverify per event');

if (!contract.canonicalEvent?.name) fail('contract missing canonical event');
else pass(`contract canonical event: ${contract.canonicalEvent.name}`);

console.log('\n=== HARNESS NOTE ===');
console.log('integration harness: static wiring only; physical device latency requires admin grant probe');

if (!process.exitCode) {
  console.log('\n[verify-manual-subscription-realtime] ok');
}
