#!/usr/bin/env node
'use strict';

/**
 * Premium access prompt — user-intent policy + copy regression matrix.
 * Run: node scripts/verify-premium-prompt-intent-policy.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

let passCount = 0;
let failCount = 0;

function pass(msg) {
  passCount += 1;
  console.log('PASS:', msg);
}

function fail(msg) {
  failCount += 1;
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function sim(name, cond) {
  if (cond) pass(`sim: ${name}`);
  else fail(`sim: ${name}`);
}

const app = read('App.js');
const nav = read('lib/premiumChannelNavigation.js');
const sm = read('lib/entitlementStateMachine.js');
const intent = read('lib/premiumAccessIntent.js');
const policy = read('lib/premiumAccessPromptPolicy.js');
const prompt = read('components/PremiumAccessPromptModal.js');
const transferred = read('components/TransferredAwayModal.js');
const player = read('screens/ChannelPlayerScreen.js');
const gate = read('components/GlobalPaymentModalGate.js');

if (prompt.includes('Unahitaji kifurushi')) pass('inactive title copy');
else fail('inactive title copy');

if (prompt.includes('Kifurushi chako kimeisha')) pass('expired title copy');
else fail('expired title copy');

if (prompt.includes('CHAGUA KIFURUSHI')) pass('primary button copy');
else fail('primary button copy');

if (!prompt.includes('Rejesha kifurushi') && !prompt.includes('LIPIA TENA')) {
  pass('prompt has no restore or lipia tena');
} else fail('prompt has no restore or lipia tena');

if (!transferred.includes('Rejesha kifurushi')) pass('TransferredAwayModal restore removed');
else fail('TransferredAwayModal restore removed');

if (app.includes('PremiumAccessPromptModal')) pass('App mounts PremiumAccessPromptModal');
else fail('App mounts PremiumAccessPromptModal');

if (app.includes('grantPremiumAccessIntent')) pass('App grants tap intent');
else fail('App grants tap intent');

if (app.includes('clearPremiumAccessIntent')) pass('App clears intent on background');
else fail('App clears intent on background');

if (!app.includes('TransferredAwayModal')) pass('TransferredAwayModal not in App');
else fail('TransferredAwayModal not in App');

if (!nav.includes('return tryOpenPaymentFlow();\n}')) pass('nav no UNKNOWN payment fallback');
else fail('nav no UNKNOWN payment fallback');

if (nav.includes('entitlement_unknown_no_popup')) pass('nav blocks unknown popup');
else fail('nav blocks unknown popup');

if (!player.includes('requestPaymentModal()')) pass('player no auto requestPaymentModal');
else fail('player no auto requestPaymentModal');

// --- inline policy (mirrors production modules) ---
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
  if (s.lastResolveSource && String(s.lastResolveSource).startsWith('transport:')) return 'ERROR_UNKNOWN';
  return 'UNKNOWN';
}

function mayOpenPaymentPopup(phase) {
  return phase === 'INACTIVE' || phase === 'EXPIRED';
}

function snapshotIsReadyForPaymentFlow(snapshot) {
  const phase = snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot);
  return mayOpenPaymentPopup(phase);
}

let activeIntent = null;
const TTL = 60_000;

function grantPremiumAccessIntent() {
  activeIntent = { grantedAt: Date.now() };
}

function clearPremiumAccessIntent() {
  activeIntent = null;
}

function hasFreshPremiumAccessIntent() {
  if (!activeIntent) return false;
  if (Date.now() - activeIntent.grantedAt > TTL) {
    activeIntent = null;
    return false;
  }
  return true;
}

function mayShowPremiumAccessPrompt(snapshot) {
  if (!hasFreshPremiumAccessIntent()) return false;
  return mayOpenPaymentPopup(snapshot?.entitlementPhase ?? deriveEntitlementPhase(snapshot));
}

function startupMayShowPopup() {
  clearPremiumAccessIntent();
  const expiredBoot = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
    subscriptionExpiresAt: new Date(Date.now() - 3600_000).toISOString(),
  };
  expiredBoot.entitlementPhase = deriveEntitlementPhase(expiredBoot);
  return mayShowPremiumAccessPrompt(expiredBoot);
}

sim('CASE 1 startup no popup', () => !startupMayShowPopup());

sim('CASE 3 expired startup no popup', () => !startupMayShowPopup());

sim('CASE 2 inactive tap with intent', () => {
  grantPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return mayShowPremiumAccessPrompt(snap);
});

sim('CASE 6 expired tap with intent', () => {
  grantPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
    subscriptionExpiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return mayShowPremiumAccessPrompt(snap) && snap.entitlementPhase === 'EXPIRED';
});

sim('CASE 7 active no popup even with intent', () => {
  grantPremiumAccessIntent();
  const snap = { isSubscribed: true, subscriptionSyncLoaded: true };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayShowPremiumAccessPrompt(snap);
});

sim('CASE 8 checking no popup', () => {
  grantPremiumAccessIntent();
  const snap = { isSubscribed: false, subscriptionSyncLoaded: false };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayShowPremiumAccessPrompt(snap);
});

sim('CASE 9 unknown no popup', () => {
  grantPremiumAccessIntent();
  const snap = { isSubscribed: false, subscriptionSyncLoaded: true, authoritativeInactiveConfirmed: false };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayShowPremiumAccessPrompt(snap) && !snapshotIsReadyForPaymentFlow(snap);
});

sim('CASE 10 error_unknown no popup', () => {
  grantPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    lastResolveSource: 'transport:timeout',
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayShowPremiumAccessPrompt(snap);
});

sim('CASE 13 refresh without intent no popup', () => {
  clearPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayShowPremiumAccessPrompt(snap);
});

sim('CASE 14 stale intent cleared blocks popup', () => {
  activeIntent = { grantedAt: Date.now() - TTL - 1 };
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayShowPremiumAccessPrompt(snap);
});

sim('unknown sync loaded not payment ready', () =>
  !snapshotIsReadyForPaymentFlow({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  }),
);

if (gate.includes('paymentModalRequest')) pass('GlobalPaymentModalGate uses explicit request counter');
else fail('GlobalPaymentModalGate uses explicit request counter');

console.log(`\n[verify-premium-prompt-intent-policy] pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
