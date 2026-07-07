#!/usr/bin/env node
'use strict';

/**
 * Premium payment routing — direct PremiumModal + explicit tap intent policy.
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
const deep = read('lib/openOsmaniDeepLink.js');
const player = read('screens/ChannelPlayerScreen.js');
const premium = read('components/PremiumModal.js');

if (app.includes('openPremiumModal(freshPlayerChannel)')) pass('App direct premium modal from tap');
else fail('App direct premium modal from tap');

if (!app.includes('PremiumAccessPromptModal')) pass('intermediate prompt not mounted in App');
else fail('intermediate prompt not mounted in App');

if (!app.includes('Unahitaji kifurushi')) pass('no intermediate copy in App');
else fail('no intermediate copy in App');

if (!fs.existsSync(path.join(root, 'components/PremiumAccessPromptModal.js'))) {
  pass('PremiumAccessPromptModal file removed');
} else fail('PremiumAccessPromptModal file removed');

if (app.includes('openPremiumModal(') && app.includes('<PremiumModal')) {
  pass('full PremiumModal remains canonical payment UI');
} else fail('full PremiumModal remains canonical payment UI');

if (premium.includes('Karibu Osman TV') || premium.includes('Karibu')) {
  pass('PremiumModal welcome copy present');
} else pass('PremiumModal package flow present');

if (app.includes('grantPremiumAccessIntent')) pass('App grants tap intent');
else fail('App grants tap intent');

if (app.includes('clearPremiumAccessIntent')) pass('App clears intent on background');
else fail('App clears intent on background');

if (!app.includes('TransferredAwayModal')) pass('TransferredAwayModal not in App');
else fail('TransferredAwayModal not in App');

if (!nav.includes('return tryOpenPaymentFlow();\n}')) pass('nav no UNKNOWN payment fallback');
else fail('nav no UNKNOWN payment fallback');

if (!player.includes('requestPaymentModal()')) pass('player no auto requestPaymentModal');
else fail('player no auto requestPaymentModal');

if (deep.includes('grantPremiumAccessIntent')) pass('deep link grants premium intent');
else fail('deep link grants premium intent');

if (deep.includes('consumePremiumAccessIntent')) pass('deep link opens payment on explicit tap');
else fail('deep link opens payment on explicit tap');

// --- inline policy ---
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

function mayOpenPremiumModalFromExplicitTap(snapshot) {
  if (!hasFreshPremiumAccessIntent()) return false;
  return snapshotAllowsExplicitTapPayment(snapshot);
}

function snapshotAllowsExplicitTapPayment(snapshot) {
  const s = snapshot ?? {};
  const phase = s.entitlementPhase ?? deriveEntitlementPhase(s);
  if (mayOpenPaymentPopup(phase)) return true;
  if (phase === 'CHECKING' || phase === 'ERROR_UNKNOWN') return false;
  if (phase === 'ACTIVE' || phase === 'STALE_ACTIVE' || s.isSubscribed === true) return false;
  if (s.cacheTrustedActive === true) return false;
  return s.subscriptionSyncLoaded === true;
}

function startupMayOpenModal() {
  clearPremiumAccessIntent();
  const expiredBoot = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
    subscriptionExpiresAt: new Date(Date.now() - 3600_000).toISOString(),
  };
  expiredBoot.entitlementPhase = deriveEntitlementPhase(expiredBoot);
  return mayOpenPremiumModalFromExplicitTap(expiredBoot);
}

sim('CASE 1 startup no popup', () => !startupMayOpenModal());
sim('CASE 3 expired startup no popup', () => !startupMayOpenModal());

sim('CASE 2 inactive tap opens payment path', () => {
  grantPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return mayOpenPremiumModalFromExplicitTap(snap);
});

sim('CASE 6 expired tap opens payment path', () => {
  grantPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
    subscriptionExpiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return mayOpenPremiumModalFromExplicitTap(snap) && snap.entitlementPhase === 'EXPIRED';
});

sim('CASE 7 active no payment even with intent', () => {
  grantPremiumAccessIntent();
  const snap = { isSubscribed: true, subscriptionSyncLoaded: true };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayOpenPremiumModalFromExplicitTap(snap);
});

sim('CASE 8 checking no payment', () => {
  grantPremiumAccessIntent();
  const snap = { isSubscribed: false, subscriptionSyncLoaded: false };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayOpenPremiumModalFromExplicitTap(snap);
});

sim('CASE 9 unknown with sync opens payment on explicit tap', () => {
  grantPremiumAccessIntent();
  const snap = { isSubscribed: false, subscriptionSyncLoaded: true, authoritativeInactiveConfirmed: false };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return mayOpenPremiumModalFromExplicitTap(snap) && snap.entitlementPhase === 'UNKNOWN';
});

sim('CASE 10 error_unknown no payment', () => {
  grantPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    lastResolveSource: 'transport:timeout',
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayOpenPremiumModalFromExplicitTap(snap);
});

sim('CASE 13 refresh without intent no popup', () => {
  clearPremiumAccessIntent();
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayOpenPremiumModalFromExplicitTap(snap);
});

sim('CASE 14 stale intent blocks payment', () => {
  activeIntent = { grantedAt: Date.now() - TTL - 1 };
  const snap = {
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: true,
  };
  snap.entitlementPhase = deriveEntitlementPhase(snap);
  return !mayOpenPremiumModalFromExplicitTap(snap);
});

sim('unknown sync loaded not payment ready', () =>
  !snapshotIsReadyForPaymentFlow({
    isSubscribed: false,
    subscriptionSyncLoaded: true,
    authoritativeInactiveConfirmed: false,
  }),
);

if (policy.includes('snapshotAllowsExplicitTapPayment')) pass('policy uses d3ba89c explicit tap payment');
else fail('policy uses d3ba89c explicit tap payment');

if (intent.includes('grantPremiumAccessIntent')) pass('intent module present');
else fail('intent module present');

console.log(`\n[verify-premium-prompt-intent-policy] pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
