#!/usr/bin/env node
/**
 * Permanent guards for known startup regressions (707d63c, 9dd7585, 4619087).
 * Run: node scripts/verify-startup-regressions.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let exitCode = 0;

function fail(msg) {
  console.error('FAIL:', msg);
  exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertContains(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) {
    fail(`${label} (${rel} missing "${needle}")`);
    return;
  }
  pass(label);
}

const app = read('App.js');
const ctx = read('context/OsmaniAppContext.jsx');
const gate = read('components/PhoneNumberGate.jsx');
const premium = read('components/PremiumModal.js');
const deepLink = read('components/OsmaniDeepLinkGate.jsx');
const globalPay = read('components/GlobalPaymentModalGate.js');
const boundary = read('components/StartupErrorBoundary.js');
const realtime = read('lib/realtimeSync.js');

// 707d63c — premiumPlaybackReady ReferenceError after phone gate
const catalogStart = app.indexOf('function ChannelCatalogScreen');
const catalogEnd = app.indexOf('function GlobalEmergencyGate');
const catalogBody = app.slice(catalogStart, catalogEnd);
const destructureMatch = catalogBody.match(/const \{([^}]+)\} = useOsmaniApp\(\)/);
if (!destructureMatch) fail('ChannelCatalogScreen must destructure useOsmaniApp');
else if (catalogBody.includes('premiumPlaybackReady') && !destructureMatch[1].includes('premiumPlaybackReady')) {
  fail('707d63c regression: premiumPlaybackReady used but not destructured');
} else pass('707d63c guard: premiumPlaybackReady destructured in ChannelCatalogScreen');

if (deepLink.includes('premiumPlaybackReady') && !deepLink.includes('premiumPlaybackReady,')) {
  fail('OsmaniDeepLinkGate must destructure premiumPlaybackReady');
} else pass('premiumPlaybackReady in OsmaniDeepLinkGate');

assertContains('context/OsmaniAppContext.jsx', 'const premiumPlaybackReady =', 'context exports premiumPlaybackReady');

// 4619087 — TransferSuccessModal import removed while still rendered
if (app.includes('<TransferSuccessModal') && !app.includes("from './components/TransferSuccessModal'")) {
  fail('4619087 regression: TransferSuccessModal used without import');
} else pass('4619087 guard: TransferSuccessModal import');

if (app.includes('<SubscriptionActivationSuccessModal') && !app.includes("from './components/SubscriptionActivationSuccessModal'")) {
  fail('SubscriptionActivationSuccessModal used without import');
} else pass('SubscriptionActivationSuccessModal import');

// 9dd7585 — phone gate / identity must not throw uncaught
assertContains('components/PhoneNumberGate.jsx', 'check_unhandled', 'PhoneNumberGate catches check errors');
assertContains('api/deviceProfile.js', 'identity_failed', 'device profile identity guard');

if (gate.includes("phase === 'checking'")) {
  fail('PhoneNumberGate must not block UI on checking phase');
} else pass('PhoneNumberGate no blocking checking UI');

// StartupErrorBoundary
assertContains('App.js', '<StartupErrorBoundary>', 'StartupErrorBoundary wraps app');
assertContains('components/StartupErrorBoundary.js', 'Hitilafu ya kuanzisha', 'startup error Swahili copy');
assertContains('components/StartupErrorBoundary.js', 'componentDidCatch', 'StartupErrorBoundary logs crashes');

// Navigation startup
assertContains('App.js', 'function RootNavigator', 'RootNavigator defined');
assertContains('App.js', '<PhoneNumberGate>', 'PhoneNumberGate in navigation tree');
assertContains('App.js', '<NavigationContainer', 'NavigationContainer mounts');

// Subscription initialization (context boot — no removal)
assertContains('context/OsmaniAppContext.jsx', 'hydrateSubscriptionFromCache', 'subscription cache hydrate');
assertContains('context/OsmaniAppContext.jsx', 'recoverBootPromiseRef', 'cold-start recover');
assertContains('context/OsmaniAppContext.jsx', 'subscriptionSyncLoaded', 'subscription sync loaded flag');
assertContains('context/OsmaniAppContext.jsx', 'applyInstantSubscriptionState', 'instant subscription UX preserved');

// SSE initialization
assertContains('context/OsmaniAppContext.jsx', 'subscribeRealtimeEvent', 'SSE listeners in context');
assertContains('lib/realtimeSync.js', 'startRealtimeSync', 'realtime sync export');
if (!realtime.includes('SUBSCRIPTION_SSE_EVENTS')) {
  fail('realtimeSync must register subscription SSE events');
} else pass('subscription SSE events registered');

// Payment pipeline components (import integrity at startup gates)
assertContains('components/PremiumModal.js', 'PaymentWaitingStep', 'PaymentWaitingStep in PremiumModal');
assertContains('components/PremiumModal.js', 'PaymentSuccessStep', 'PaymentSuccessStep in PremiumModal');
assertContains('components/PremiumModal.js', "from './PaymentWaitingStep'", 'PaymentWaitingStep imported');
assertContains('components/PremiumModal.js', "from './PaymentSuccessStep'", 'PaymentSuccessStep imported');
assertContains('components/GlobalPaymentModalGate.js', 'PremiumModal', 'GlobalPaymentModalGate uses PremiumModal');

// Account screen lazy mount — imports must exist
assertContains('screens/AkauntiYanguScreen.js', 'AkauntiYanguScreen', 'account screen module');
assertContains('App.js', 'AkauntiYanguScreen', 'account screen registered in tabs');

// Unhandled rejection logging (startup diagnostics)
assertContains('App.js', 'unhandled_rejection', 'unhandled rejection logger');

if (exitCode) {
  console.error('\n[verify-startup-regressions] FAILED');
  process.exit(exitCode);
}

console.log('\n[verify-startup-regressions] ok');
