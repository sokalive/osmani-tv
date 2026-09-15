#!/usr/bin/env node
'use strict';

/**
 * KULIPIA must never flash for known-active / STALE_ACTIVE / CHECKING-before-hydrate.
 * Run: node scripts/verify-kulipia-no-flash.js
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

function mayShowPaymentAffordance(input) {
  if (!input?.isPremium || input?.freeMode) return false;
  if (input?.isSubscribed === true || input?.cacheTrustedActive === true) return false;
  const phase =
    input?.entitlementPhase ??
    deriveEntitlementPhase({
      isSubscribed: input?.isSubscribed === true,
      cacheTrustedActive: input?.cacheTrustedActive === true,
      authoritativeInactiveConfirmed: input?.authoritativeInactiveConfirmed === true,
      subscriptionSyncLoaded: input?.subscriptionSyncLoaded === true,
    });
  if (phase === 'ACTIVE' || phase === 'STALE_ACTIVE') return false;
  if (phase === 'INACTIVE' || phase === 'EXPIRED') return true;
  if (phase === 'ERROR_UNKNOWN') return false;
  if (phase === 'CHECKING') return input?.subscriptionCacheHydrateAttempted === true;
  if (input?.subscriptionSyncLoaded === true) return true;
  return input?.subscriptionCacheHydrateAttempted === true;
}

function sim(label, cond) {
  if (cond) pass(label);
  else fail(label);
}

const policy = read('lib/paymentAffordancePolicy.js');
const ctx = read('context/OsmaniAppContext.jsx');
const app = read('App.js');
const reconcile = read('lib/subscriptionReconcile.js');
const gate = read('lib/premiumTapGate.js');

if (!policy.includes('subscriptionCacheHydrateAttempted')) {
  fail('policy must gate CHECKING on hydrate attempted');
} else pass('policy gates CHECKING on hydrate attempted');

if (!policy.includes("phase === 'ERROR_UNKNOWN'")) {
  fail('policy must hide KULIPIA on ERROR_UNKNOWN');
} else pass('policy hides KULIPIA on ERROR_UNKNOWN');

if (!gate.includes('mayShowPaymentAffordance')) {
  fail('shouldShowKulipiaBadge must delegate to mayShowPaymentAffordance');
} else pass('badge delegates to mayShowPaymentAffordance');

if (ctx.includes('cacheTrustedActiveRef.current && isSubscribedRef.current')) {
  fail('snapshot cacheTrustedActive must not require isSubscribed');
} else pass('snapshot cacheTrustedActive independent of isSubscribed');

if (!ctx.includes('subscriptionCacheHydrateAttempted')) {
  fail('context must expose hydrate attempted');
} else pass('context exposes hydrate attempted');

if (ctx.includes('optimistic_clear')) {
  fail('SSE revoke must not optimistic-clear isSubscribed');
} else pass('SSE revoke no optimistic clear');

if (!ctx.includes('refused_clear_without_authoritative_inactive')) {
  fail('reverify must refuse clear without authoritative inactive');
} else pass('reverify refuses non-authoritative clear');

if (!ctx.includes('transport_preserved_memory')) {
  fail('transport must preserve in-memory active during reconcile');
} else pass('transport preserves memory active');

if (
  reconcile.includes("r === 'sse:sync_stream_connected'") &&
  !reconcile.includes('SSE reconnect is not entitlement evidence')
) {
  fail('SSE reconnect must not be authoritative reconcile');
} else pass('SSE reconnect not authoritative reconcile');

if (!app.includes('subscriptionCacheHydrateAttempted={subscriptionCacheHydrateAttempted}')) {
  fail('App badge must pass hydrate attempted');
} else pass('App badge passes hydrate attempted');

// --- state transition simulations ---
sim('boot first paint CHECKING no hydrate → no KULIPIA', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      freeMode: false,
      isSubscribed: false,
      cacheTrustedActive: false,
      entitlementPhase: 'CHECKING',
      subscriptionCacheHydrateAttempted: false,
      subscriptionSyncLoaded: false,
    }) === false
  );
});

sim('STALE_ACTIVE cache → no KULIPIA even if isSubscribed false', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      freeMode: false,
      isSubscribed: false,
      cacheTrustedActive: true,
      entitlementPhase: 'STALE_ACTIVE',
      subscriptionCacheHydrateAttempted: true,
    }) === false
  );
});

sim('ACTIVE → no KULIPIA', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      isSubscribed: true,
      entitlementPhase: 'ACTIVE',
    }) === false
  );
});

sim('ERROR_UNKNOWN transport → no KULIPIA', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      isSubscribed: false,
      cacheTrustedActive: false,
      entitlementPhase: 'ERROR_UNKNOWN',
      subscriptionSyncLoaded: true,
      subscriptionCacheHydrateAttempted: true,
    }) === false
  );
});

sim('CHECKING after empty hydrate → KULIPIA (unpaid boot)', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      isSubscribed: false,
      cacheTrustedActive: false,
      entitlementPhase: 'CHECKING',
      subscriptionCacheHydrateAttempted: true,
      subscriptionSyncLoaded: false,
    }) === true
  );
});

sim('INACTIVE authoritative → KULIPIA', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      isSubscribed: false,
      entitlementPhase: 'INACTIVE',
      authoritativeInactiveConfirmed: true,
      subscriptionSyncLoaded: true,
      subscriptionCacheHydrateAttempted: true,
    }) === true
  );
});

sim('UNKNOWN after sync unpaid → KULIPIA', () => {
  return (
    mayShowPaymentAffordance({
      isPremium: true,
      isSubscribed: false,
      entitlementPhase: 'UNKNOWN',
      subscriptionSyncLoaded: true,
      subscriptionCacheHydrateAttempted: true,
    }) === true
  );
});

// Simulate forbidden ACTIVE → clear → CHECKING → KULIPIA flash sequence
sim('forbidden flash sequence blocked', () => {
  const before = mayShowPaymentAffordance({
    isPremium: true,
    isSubscribed: true,
    entitlementPhase: 'ACTIVE',
  });
  const mid = mayShowPaymentAffordance({
    isPremium: true,
    isSubscribed: false,
    cacheTrustedActive: true,
    entitlementPhase: 'STALE_ACTIVE',
    subscriptionCacheHydrateAttempted: true,
  });
  const checking = mayShowPaymentAffordance({
    isPremium: true,
    isSubscribed: false,
    cacheTrustedActive: false,
    entitlementPhase: 'CHECKING',
    subscriptionCacheHydrateAttempted: false,
  });
  return before === false && mid === false && checking === false;
});

if (!process.exitCode) {
  console.log('\n[verify-kulipia-no-flash] ok');
}
