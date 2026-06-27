#!/usr/bin/env node
'use strict';

/**
 * Unit checks for subscription SSE device filtering (false transfer modal fix).
 * Run: node scripts/verify-subscription-sse-guard.js
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

const ctx = fs.readFileSync(path.join(root, 'context/OsmaniAppContext.jsx'), 'utf8');
const player = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'lib/subscriptionSseGuard.js'), 'utf8');
const analytics = fs.readFileSync(path.join(root, 'api/analytics.js'), 'utf8');

if (!guard.includes('subscriptionTransferSseRole')) fail('guard export missing');
else pass('subscriptionSseGuard module');

if (!ctx.includes('subscriptionTransferSseRole')) fail('context must use SSE guard');
else pass('context imports SSE guard');

if (!ctx.includes('sourceTransferClearLockUntilRef')) {
  fail('source transfer clear lock ref missing');
} else pass('source transfer clear lock');

if (!ctx.includes('isExplicitTransferRevokeReason')) fail('context must filter recovery transfer SSE');
else pass('context filters recovery transfer SSE');

if (!ctx.includes('devicesShareIdentity')) fail('context must ignore same-device alias transfers');
else pass('same-device alias guard');

if (!ctx.includes('showSuccessModal: userInitiated')) {
  fail('transfer success modal must require user-initiated transfer');
} else pass('transfer modal user-initiated only');

if (!guard.includes('isExplicitTransferRevokeReason')) fail('guard must export transfer reason filter');
else pass('explicit transfer reason filter');

if (!guard.includes('devicesShareIdentity')) fail('guard must export devicesShareIdentity');
else pass('devicesShareIdentity export');

if (!guard.includes('isUserConfirmedTransferReason')) fail('guard must export user transfer reason');
else pass('user transfer reason export');

if (ctx.includes('resolveSubscriptionLossModalReason')) {
  pass('subscription_revoked uses confirmed loss modal reason');
} else {
  fail('subscription_revoked must resolve modal reason from verify');
}

if (!player.includes('subscriptionTransferSseRole')) fail('player must filter SSE kill events');
else pass('player filters transfer/revoke SSE');

if (!analytics.includes('getApiBaseUrl()')) fail('analytics must resolve API base at request time');
else pass('analytics dynamic API base');

if (!analytics.includes('SESSION_HEARTBEAT_RETRIES_MS')) fail('analytics session heartbeat retries');
else pass('analytics session heartbeat retries');

if (player.includes("nextState !== 'background'")) pass('player ignores inactive app state for analytics');
else fail('player must not stop analytics on inactive');

if (!process.exitCode) {
  console.log('\n[verify-subscription-sse-guard] ok');
}
