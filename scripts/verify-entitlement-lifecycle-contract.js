#!/usr/bin/env node
'use strict';

/**
 * Full entitlement lifecycle contract — state machine, cache, sticky player,
 * transport vs authoritative loss, SSE grant fail-closed, payment unlock hooks.
 * Run: node scripts/verify-entitlement-lifecycle-contract.js
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

function sim(label, fn) {
  try {
    if (!fn()) fail(label);
    else pass(label);
  } catch (e) {
    fail(`${label}: ${e.message}`);
  }
}

const {
  isStaleActiveSubscriptionCache,
  shouldHydrateSubscriptionCache,
} = require('../lib/subscriptionCacheRepair');

/** Inlined mirrors of production helpers (ESM/RN import graph is not Node-safe). */
function deriveEntitlementPhase(snapshot) {
  const s = snapshot ?? {};
  if (s.isSubscribed === true) return 'ACTIVE';
  if (s.cacheTrustedActive === true) return 'STALE_ACTIVE';
  if (s.authoritativeInactiveConfirmed === true) {
    const exp = s.subscriptionExpiresAt ?? s.expiresAt ?? null;
    if (exp) {
      const t = Date.parse(String(exp));
      if (Number.isFinite(t) && t <= Date.now()) return 'EXPIRED';
    }
    return 'INACTIVE';
  }
  if (s.subscriptionSyncLoaded !== true) return 'CHECKING';
  if (s.lastResolveSource && String(s.lastResolveSource).startsWith('transport:')) {
    return 'ERROR_UNKNOWN';
  }
  return 'UNKNOWN';
}

function mayOpenPaymentPopup(phase) {
  return phase === 'INACTIVE' || phase === 'EXPIRED';
}

function mayNavigatePremiumImmediate(phase) {
  return phase === 'ACTIVE' || phase === 'STALE_ACTIVE';
}

function snapshotAllowsExplicitTapPayment(snapshot) {
  const s = snapshot ?? {};
  const phase = s.entitlementPhase ?? deriveEntitlementPhase(s);
  if (mayOpenPaymentPopup(phase)) return true;
  if (phase === 'CHECKING' || phase === 'ERROR_UNKNOWN') return false;
  if (mayNavigatePremiumImmediate(phase) || s.isSubscribed === true) return false;
  if (s.cacheTrustedActive === true) return false;
  return s.subscriptionSyncLoaded === true;
}

function isTrustworthyActiveCache(cached) {
  if (!cached?.active) return false;
  if (isStaleActiveSubscriptionCache(cached)) return false;
  return true;
}

function isSubscriptionVerificationUnavailable(verifyResult) {
  if (!verifyResult) return true;
  if (verifyResult.active === true) return false;
  if (verifyResult.transportPreserved === true) return true;
  if (verifyResult.retryable === true) return true;
  if (verifyResult.active == null) return true;
  const src = String(verifyResult.resolveSource ?? '');
  if (src.startsWith('transport:')) return true;
  return false;
}

function isConfirmedSubscriptionLoss(verifyResult) {
  if (!verifyResult || verifyResult.active === true) return false;
  if (isSubscriptionVerificationUnavailable(verifyResult)) return false;
  return String(verifyResult.resolveSource ?? '') === 'inactive';
}

function extractExplicitInactiveReason(verifyResult) {
  if (!verifyResult || typeof verifyResult !== 'object') return null;
  const direct = verifyResult.inactiveReason ?? verifyResult.inactive_reason;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  return null;
}

function shouldKillStickyOnConfirmedLoss(verifyResult, hardWallClockDone) {
  if (!isConfirmedSubscriptionLoss(verifyResult)) return false;
  if (hardWallClockDone) {
    const reason = String(extractExplicitInactiveReason(verifyResult) ?? '').toLowerCase();
    if (reason === 'expired' || reason === '' || reason === 'null') return false;
  }
  return true;
}

const now = Date.parse('2026-09-14T12:00:00.000Z');
const past = '2026-09-01T00:00:00.000Z';
const future = '2026-10-01T00:00:00.000Z';

sim('ACTIVE', () => deriveEntitlementPhase({ isSubscribed: true }) === 'ACTIVE');
sim('STALE_ACTIVE', () =>
  deriveEntitlementPhase({
    isSubscribed: false,
    cacheTrustedActive: true,
    subscriptionSyncLoaded: true,
  }) === 'STALE_ACTIVE',
);
sim('INACTIVE', () =>
  deriveEntitlementPhase({
    authoritativeInactiveConfirmed: true,
    subscriptionSyncLoaded: true,
  }) === 'INACTIVE',
);
sim('EXPIRED', () =>
  deriveEntitlementPhase({
    authoritativeInactiveConfirmed: true,
    subscriptionExpiresAt: past,
    subscriptionSyncLoaded: true,
  }) === 'EXPIRED',
);
sim('CHECKING', () =>
  deriveEntitlementPhase({ subscriptionSyncLoaded: false, isSubscribed: false }) === 'CHECKING',
);
sim('ERROR_UNKNOWN', () =>
  deriveEntitlementPhase({
    subscriptionSyncLoaded: true,
    lastResolveSource: 'transport:timeout',
  }) === 'ERROR_UNKNOWN',
);
sim('UNKNOWN unpaid after sync', () =>
  deriveEntitlementPhase({ subscriptionSyncLoaded: true, isSubscribed: false }) === 'UNKNOWN',
);

sim('ACTIVE may navigate', () => mayNavigatePremiumImmediate('ACTIVE'));
sim('STALE_ACTIVE may navigate', () => mayNavigatePremiumImmediate('STALE_ACTIVE'));
sim('INACTIVE may open payment', () => mayOpenPaymentPopup('INACTIVE'));
sim('EXPIRED may open payment', () => mayOpenPaymentPopup('EXPIRED'));
sim('ERROR_UNKNOWN must not open payment', () => !mayOpenPaymentPopup('ERROR_UNKNOWN'));
sim('CHECKING must not open payment', () => !mayOpenPaymentPopup('CHECKING'));

sim('explicit tap payment for unpaid after sync', () =>
  snapshotAllowsExplicitTapPayment({
    subscriptionSyncLoaded: true,
    isSubscribed: false,
    cacheTrustedActive: false,
  }),
);
sim('explicit tap blocked while ERROR_UNKNOWN', () =>
  !snapshotAllowsExplicitTapPayment({
    subscriptionSyncLoaded: true,
    lastResolveSource: 'transport:http',
    isSubscribed: false,
  }),
);

sim('expired cache not trustworthy', () =>
  !isTrustworthyActiveCache({ active: true, expiresAt: past }),
);
sim('future cache trustworthy', () =>
  isTrustworthyActiveCache({
    active: true,
    expiresAt: future,
    planSnapshot: { remaining_seconds: 1000 },
  }),
);
sim('leftover remainingSeconds past expiresAt is stale', () =>
  isStaleActiveSubscriptionCache(
    { active: true, expiresAt: past, planSnapshot: { remaining_seconds: 999 } },
    now,
  ),
);
sim('must not hydrate expired cache', () =>
  !shouldHydrateSubscriptionCache({ active: true, expiresAt: past }, now),
);

sim('transport timeout not confirmed loss', () =>
  !isConfirmedSubscriptionLoss({
    active: false,
    resolveSource: 'transport:timeout',
    error: 'timeout',
  }),
);
sim('5xx not confirmed loss', () =>
  !isConfirmedSubscriptionLoss({
    active: false,
    resolveSource: 'transport:http',
    error: 'HTTP 503',
    retryable: true,
  }),
);
sim('authoritative inactive is confirmed loss', () =>
  isConfirmedSubscriptionLoss({
    active: false,
    resolveSource: 'inactive',
    inactiveReason: 'revoked',
  }),
);
sim('authoritative expired is confirmed loss', () =>
  isConfirmedSubscriptionLoss({
    active: false,
    resolveSource: 'inactive',
    inactiveReason: 'expired',
  }),
);
sim('transport unavailable helper', () =>
  isSubscriptionVerificationUnavailable({
    active: false,
    resolveSource: 'transport:primary',
    error: 'Network request failed',
  }),
);

sim('sticky: transport does not kill', () =>
  !shouldKillStickyOnConfirmedLoss({ active: false, resolveSource: 'transport:timeout' }, false),
);
sim('sticky: revoke kills before wall-clock', () =>
  shouldKillStickyOnConfirmedLoss(
    { active: false, resolveSource: 'inactive', inactiveReason: 'revoked' },
    false,
  ),
);
sim('sticky: expiry kills before deferred wall-clock', () =>
  shouldKillStickyOnConfirmedLoss(
    { active: false, resolveSource: 'inactive', inactiveReason: 'expired' },
    false,
  ),
);
sim('sticky: deferred wall-clock keeps expired session', () =>
  !shouldKillStickyOnConfirmedLoss(
    { active: false, resolveSource: 'inactive', inactiveReason: 'expired' },
    true,
  ),
);
sim('sticky: revoke still kills after deferred wall-clock', () =>
  shouldKillStickyOnConfirmedLoss(
    { active: false, resolveSource: 'inactive', inactiveReason: 'revoked' },
    true,
  ),
);

const player = read('screens/ChannelPlayerScreen.js');
const boot = read('lib/subscriptionRecoveryBoot.js');
const sse = read('lib/subscriptionSseInstant.js');
const repair = read('lib/subscriptionCacheRepair.js');
const modal = read('components/PremiumModal.js');
const ctx = read('context/OsmaniAppContext.jsx');
const api = read('api/subscription.js');

if (!player.includes('player-sticky-inactive-reconcile')) {
  fail('player must reconcile sticky when isSubscribed flips false');
} else pass('sticky inactive reconcile present');

if (!player.includes('premiumGateSessionRef.current.granted = false')) {
  fail('player kills must clear sticky granted');
} else pass('sticky granted cleared on kill');

if (!player.includes('expiry_sync_deferred_keep_session')) {
  fail('deferred wall-clock must keep session on pure expiry sync');
} else pass('deferred expiry keep-session marker');

if (player.match(/!accessAllowed \|\| !isSubscribed\) return undefined;\s*const id = setInterval/)) {
  fail('player-expiry-sync must not require isSubscribed');
} else pass('player-expiry-sync independent of isSubscribed');

if (!boot.includes('readSubscriptionCache')) fail('boot purge must use raw cache');
else pass('boot purge uses raw cache');

if (!boot.includes('boot-expired-purge')) fail('boot must purge temporally expired cache');
else pass('boot expired purge present');

if (!repair.includes('expMs != null && expMs <= nowMs) return true')) {
  fail('cache repair must treat past expiresAt as stale before remainingSeconds');
} else pass('cache repair expiresAt precedence');

if (!sse.includes('if (!deviceId) return false')) {
  fail('SSE grant must fail closed without device id');
} else pass('SSE grant fail-closed without device id');

if (sse.includes('? { active: true }')) {
  fail('SSE parse must not invent active:true fallback');
} else pass('SSE parse does not invent active:true');

if (!modal.includes('finalizePaymentSuccess')) fail('payment finalize present');
else pass('payment finalize present');

if (!ctx.includes('applyInstantSubscriptionState')) fail('instant unlock present');
else pass('instant unlock present');

if (!ctx.includes('unlockChannels')) fail('unlockChannels present');
else pass('unlockChannels present');

if (!api.includes('soft-trust bootstrap hint')) {
  fail('subscription cache comment must describe soft-trust hydrate');
} else pass('cache soft-trust comment aligned');

if (!process.exitCode) {
  console.log('\n[verify-entitlement-lifecycle-contract] ok');
}
