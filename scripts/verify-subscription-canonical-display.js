#!/usr/bin/env node
'use strict';

/**
 * Canonical subscription display — weekly stack, cache stale, backend remaining.
 * Run: node scripts/verify-subscription-canonical-display.js
 */

const fs = require('fs');
const path = require('path');
const {
  enrichCanonicalSubscriptionTiming,
  resolveCanonicalExpiresAt,
  resolveDisplayDurationDays,
} = require('../lib/subscriptionCanonical');
const { computeSubscriptionProgress, getServerAnchoredRemainingMs } = require('../lib/subscriptionMath');
const { mergeSubscriptionDetails } = require('../lib/subscriptionDetailsMerge');

const root = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

// Weekly paid 27 Jun 2026, stacked expiry 18 Jul 2026 (~21d remaining at verify)
const serverNow = Date.parse('2026-06-27T10:00:00.000Z');
const expiresAt = '2026-07-18T10:00:00.000Z';
const remainingSeconds = Math.floor((Date.parse(expiresAt) - serverNow) / 1000);

const stacked = enrichCanonicalSubscriptionTiming({
  active: true,
  expiresAt,
  planDurationDays: 7,
  plan_duration_days: 7,
  remainingSeconds,
  remainingDays: Math.floor(remainingSeconds / 86400),
  serverTime: new Date(serverNow).toISOString(),
  amount: 3000,
  currency: 'TZS',
});

const displayDays = resolveDisplayDurationDays(stacked);
if (displayDays !== 7) {
  fail(`stacked weekly Muda wa Kifurushi must stay package 7, got ${displayDays}`);
} else pass('stacked weekly Muda wa Kifurushi locked to package 7 (not span 21)');

const progress = computeSubscriptionProgress({
  startedAt: stacked.startedAt,
  periodStartAt: stacked.periodStartAt,
  expiresAt: stacked.expiresAt,
  displayDurationDays: stacked.displayDurationDays,
  planDurationDays: 7,
  serverTime: stacked.serverTime,
  serverTimeFetchedAt: serverNow,
  nowMsOverride: serverNow,
});
if (!progress.ok) fail('stacked progress should be ok');
else pass('stacked progress bar ok');
if (progress.remainingDays !== 7) {
  fail(`stacked visual remainingDays must cap to assigned plan 7, got ${progress.remainingDays}`);
} else pass('stacked entitlement is display-capped to assigned plan');

const remMs = getServerAnchoredRemainingMs({
  expiresAt,
  serverTime: new Date(serverNow).toISOString(),
  serverTimeFetchedAt: serverNow,
  nowMsOverride: serverNow,
});
if (Math.abs(remMs - remainingSeconds * 1000) > 2000) {
  fail('countdown ms mismatch');
} else pass('countdown anchored to backend expiry');

// Fresh weekly — 7 days, no stack
const freshStart = '2026-06-27T10:00:00.000Z';
const freshEnd = '2026-07-04T10:00:00.000Z';
const freshRem = Math.floor((Date.parse(freshEnd) - serverNow) / 1000);
const fresh = enrichCanonicalSubscriptionTiming({
  expiresAt: freshEnd,
  startedAt: freshStart,
  planDurationDays: 7,
  remainingSeconds: freshRem,
});
if (resolveDisplayDurationDays(fresh) !== 7) {
  fail(`fresh weekly expected 7 days, got ${resolveDisplayDurationDays(fresh)}`);
} else pass('fresh weekly shows 7 days');

// Cache stale vs backend fresh — merge must not keep old expiry
const prev = {
  expiresAt: '2026-07-04T10:00:00.000Z',
  planDurationDays: 7,
  amount: 3000,
};
const incoming = {
  expiresAt: '2026-07-18T10:00:00.000Z',
  planDurationDays: 7,
  displayDurationDays: 21,
  remainingSeconds,
};
const merged = mergeSubscriptionDetails(prev, incoming);
if (merged.expiresAt !== incoming.expiresAt) {
  fail('merge kept stale expiry');
} else pass('merge overwrites stale expiry with backend');

if (resolveCanonicalExpiresAt({ expiresAt: incoming.expiresAt }, '2026-07-04T10:00:00.000Z') !== incoming.expiresAt) {
  fail('canonical expiry must prefer details');
} else pass('canonical expiry prefers details');

const screen = fs.readFileSync(path.join(root, 'screens', 'AkauntiYanguScreen.js'), 'utf8');
if (!screen.includes('resolveCanonicalExpiresAt')) fail('account uses canonical expiry');
else pass('account uses canonical expiry');
if (!screen.includes('canonicalExpiresAt')) fail('account unified expiry binding');
else pass('account unified expiry binding');
if (!screen.includes('lastDurationDaysRef')) fail('account sticky duration ref required for sparse refresh');
else pass('account sticky duration ref');

const ctx = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
if (!ctx.includes('enrichCanonicalSubscriptionTiming')) fail('context must enrich canonical timing');
else pass('context enriches canonical timing');

const api = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');
if (!api.includes('pickRemainingSeconds')) fail('api must parse remaining_seconds');
else pass('api parses remaining_seconds');

// Custom admin expiry: 7-day package, far backend expires_at — package duration stays 7
const adminLong = enrichCanonicalSubscriptionTiming({
  active: true,
  expiresAt: '2026-07-17T10:00:00.000Z',
  startedAt: '2026-06-27T10:00:00.000Z',
  planDurationDays: 7,
  remainingSeconds: 20 * 86400,
});
if (resolveDisplayDurationDays(adminLong) !== 7) {
  fail(`admin far expiry on 7d package: Muda wa Kifurushi expected 7, got ${resolveDisplayDurationDays(adminLong)}`);
} else pass('admin far expiry keeps package duration 7 (span not shown as Muda wa Kifurushi)');

// Custom admin expiry: 30-day package, short remaining — package duration stays 30
const adminShort = enrichCanonicalSubscriptionTiming({
  active: true,
  expiresAt: '2026-06-30T10:00:00.000Z',
  startedAt: '2026-06-27T10:00:00.000Z',
  planDurationDays: 30,
  remainingSeconds: 3 * 86400,
});
if (resolveDisplayDurationDays(adminShort) !== 30) {
  fail(`admin short remaining on 30d package: Muda wa Kifurushi expected 30, got ${resolveDisplayDurationDays(adminShort)}`);
} else pass('admin short remaining keeps package duration 30');

const shortProgress = computeSubscriptionProgress({
  startedAt: adminShort.startedAt,
  periodStartAt: adminShort.periodStartAt,
  expiresAt: adminShort.expiresAt,
  planDurationDays: 30,
  displayDurationDays: adminShort.displayDurationDays,
  remainingSeconds: adminShort.remainingSeconds,
  serverTime: '2026-06-27T10:00:00.000Z',
  serverTimeFetchedAt: Date.parse('2026-06-27T10:00:00.000Z'),
  nowMsOverride: Date.parse('2026-06-27T10:00:00.000Z'),
});
if (!shortProgress.ok || shortProgress.remainingDays !== 3) {
  fail(`short admin progress expected 3 days remaining, got ${shortProgress.remainingDays}`);
} else pass('short admin progress bar uses backend expiry');

// Exact hour/minute countdown
const exactServer = Date.parse('2026-06-27T14:00:00.000Z');
const exactExpires = '2026-06-27T16:37:00.000Z';
const exactRemMs = getServerAnchoredRemainingMs({
  expiresAt: exactExpires,
  serverTime: new Date(exactServer).toISOString(),
  serverTimeFetchedAt: exactServer,
  nowMsOverride: exactServer,
});
const expectedExactMs = Date.parse(exactExpires) - exactServer;
if (Math.abs(exactRemMs - expectedExactMs) > 1000) {
  fail('exact hour/minute countdown ms mismatch');
} else pass('exact hour/minute countdown from backend expires_at');

if (!process.exitCode) {
  console.log('\n[verify-subscription-canonical-display] ok');
}
