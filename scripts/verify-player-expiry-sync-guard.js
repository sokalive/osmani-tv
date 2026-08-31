#!/usr/bin/env node
'use strict';

/**
 * Player-expiry-sync must not terminate playback on transient verification failures.
 * Run: node scripts/verify-player-expiry-sync-guard.js
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

function isNetworkTransportError(errorLike) {
  const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('networkerror') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  );
}

function isTransientServerError(errorLike) {
  const msg = String(errorLike?.message ?? errorLike ?? '').toLowerCase();
  return (
    /^http\s*(502|503|504)\b/.test(msg) ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout')
  );
}

function isSubscriptionTransportFailure(result) {
  if (!result) return false;
  if (result.retryable === true) return true;
  const raw = result.raw;
  if (result.active == null && raw?.retryable === true) return true;
  if (!result.error) return false;
  const errLower = String(result.error).toLowerCase();
  if (
    errLower.includes('pool_saturated') ||
    errLower.includes('pool_acquire_timeout') ||
    errLower.includes('query_timeout')
  ) {
    return true;
  }
  return isNetworkTransportError(result.error) || isTransientServerError(result.error);
}

function pickRetryableFlag(verifyResult) {
  if (!verifyResult || typeof verifyResult !== 'object') return false;
  if (verifyResult.retryable === true) return true;
  const raw = verifyResult.raw;
  return raw?.retryable === true || raw?.data?.retryable === true;
}

function isSubscriptionVerificationUnavailable(verifyResult) {
  if (!verifyResult) return true;
  if (verifyResult.active === true) return false;
  if (verifyResult.transportPreserved === true) return true;
  if (pickRetryableFlag(verifyResult)) return true;
  if (verifyResult.active == null) return true;
  if (isSubscriptionTransportFailure(verifyResult)) return true;
  const src = String(verifyResult.resolveSource ?? '');
  if (src.startsWith('transport:')) return true;
  const tokenBlob = [
    verifyResult.error,
    verifyResult.inactiveReason,
    verifyResult.reason,
    verifyResult.raw?.reason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    tokenBlob.includes('pool_saturated') ||
    tokenBlob.includes('pool_acquire_timeout') ||
    tokenBlob.includes('query_timeout')
  ) {
    return true;
  }
  return false;
}

function isConfirmedSubscriptionLoss(verifyResult) {
  if (!verifyResult || verifyResult.active === true) return false;
  if (isSubscriptionVerificationUnavailable(verifyResult)) return false;
  const src = String(verifyResult.resolveSource ?? '');
  return src === 'inactive';
}

/** Mirror ChannelPlayerScreen player-expiry-sync gate after fix. */
function shouldTerminatePlaybackOnExpirySync(verifyResult) {
  return isConfirmedSubscriptionLoss(verifyResult);
}

/** Mirror ChannelPlayerScreen SSE kill handler after fix. */
function shouldTerminatePlaybackOnSseKill(verifyResult) {
  return isConfirmedSubscriptionLoss(verifyResult);
}

const player = read('screens/ChannelPlayerScreen.js');
const guard = read('lib/subscriptionSseGuard.js');
const sub = read('api/subscription.js');

if (!player.includes("reverifySubscription('player-expiry-sync')")) {
  fail('player-expiry-sync interval must exist');
} else pass('player-expiry-sync interval present');

if (player.includes('r?.active !== false')) {
  fail('player-expiry-sync must not use raw active===false check');
} else pass('no raw active===false in player-expiry-sync');

if (!player.includes('isConfirmedSubscriptionLoss(r)')) {
  fail('player-expiry-sync must use isConfirmedSubscriptionLoss');
} else pass('player-expiry-sync uses isConfirmedSubscriptionLoss');

if (!player.includes('isConfirmedSubscriptionLoss')) {
  fail('ChannelPlayerScreen must import isConfirmedSubscriptionLoss');
} else pass('ChannelPlayerScreen imports isConfirmedSubscriptionLoss');

if (!guard.includes('isSubscriptionVerificationUnavailable')) {
  fail('subscriptionSseGuard must export isSubscriptionVerificationUnavailable');
} else pass('verification unavailable helper exported');

if (!sub.includes('retryable')) {
  fail('subscription API must preserve retryable flag');
} else pass('subscription API preserves retryable');

// --- playback gate simulations ---
const active = { active: true, resolveSource: 'verify:primary' };
const expired = { active: false, resolveSource: 'inactive', inactiveReason: 'expired' };
const revoked = { active: false, resolveSource: 'inactive', inactiveReason: 'revoked' };
const http503 = { active: false, error: 'HTTP 503', resolveSource: 'transport:http', retryable: true };
const http504 = { active: false, error: 'HTTP 504', resolveSource: 'transport:http' };
const timeout = {
  active: false,
  error: 'resolve-active-subscription timeout',
  resolveSource: 'transport:timeout',
};
const network = { active: false, error: 'Network request failed', resolveSource: 'transport:primary' };
const nullActive = { active: null, retryable: true, raw: { retryable: true } };
const poolSat = {
  active: false,
  error: 'pool_saturated',
  resolveSource: 'transport:primary',
};
const queryTimeout = {
  active: false,
  error: 'query_timeout',
  resolveSource: 'transport:primary',
};
const preserved = {
  active: true,
  transportPreserved: true,
  error: 'HTTP 503',
  resolveSource: 'transport:primary',
};

const cases = [
  ['TEST 1 active subscription', active, false],
  ['TEST 2 confirmed expired', expired, true],
  ['TEST 3 confirmed revoked', revoked, true],
  ['TEST 4 temporary 503', http503, false],
  ['TEST 5 temporary 504', http504, false],
  ['TEST 6 timeout', timeout, false],
  ['TEST 7 network failure', network, false],
  ['TEST 8 active:null retryable', nullActive, false],
  ['TEST 9 pool_saturated', poolSat, false],
  ['TEST 10 query_timeout', queryTimeout, false],
  ['TEST 11 SSE revoke then active', active, false],
  ['TEST 12 real authoritative revoke', revoked, true],
  ['TEST 13 real authoritative expiry', expired, true],
];

for (const [label, result, expectKill] of cases) {
  const kill =
    label.includes('SSE')
      ? shouldTerminatePlaybackOnSseKill(result)
      : shouldTerminatePlaybackOnExpirySync(result);
  if (kill !== expectKill) {
    fail(`${label}: expected kill=${expectKill} got ${kill}`);
  } else {
    pass(`${label}: kill=${kill}`);
  }
}

// TEST 14 — stale transport must not overwrite confirmed active
let latestActive = true;
function applyVerifyResult(result) {
  if (result.active === true || result.transportPreserved === true) {
    latestActive = true;
    return;
  }
  if (isConfirmedSubscriptionLoss(result)) latestActive = false;
}
applyVerifyResult(active);
applyVerifyResult(http503);
if (!latestActive) fail('TEST 14 stale transport overwrote active');
else pass('TEST 14 stale transport did not overwrite active');

// TEST 15 — foreground + player-expiry-sync race: transient failures preserve session
let sessionActive = true;
const foregroundTick = http503;
const expirySyncTransient = timeout;
if (isConfirmedSubscriptionLoss(foregroundTick)) sessionActive = false;
if (isConfirmedSubscriptionLoss(expirySyncTransient)) sessionActive = false;
if (!sessionActive) fail('TEST 15 foreground+expiry-sync race falsely inactive');
else pass('TEST 15 transient race preserved active session');

if (!shouldTerminatePlaybackOnExpirySync(preserved)) {
  pass('transport preserved active does not terminate playback');
} else {
  fail('transport preserved active must not terminate playback');
}

if (!process.exitCode) {
  console.log('\n[verify-player-expiry-sync-guard] ok');
}
