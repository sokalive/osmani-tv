#!/usr/bin/env node
'use strict';

/**
 * Verify subscription remaining countdown formatter + account card binding.
 * Run: node scripts/verify-subscription-remaining-countdown.js
 */

const fs = require('fs');
const path = require('path');
const {
  formatSubscriptionRemainingCountdown,
} = require('../lib/formatSubscriptionRemaining');
const { getServerAnchoredRemainingMs } = require('../lib/subscriptionMath');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function assertEq(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label}: expected "${expected}", got "${actual}"`);
    return;
  }
  pass(label);
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

assertEq('expired', formatSubscriptionRemainingCountdown(0), 'Kifurushi Kimeisha');
assertEq('7 days', formatSubscriptionRemainingCountdown(7 * DAY), '7 siku zimebaki');
assertEq('6 days', formatSubscriptionRemainingCountdown(6 * DAY + 12 * HOUR), '6 siku zimebaki');
assertEq('1 day', formatSubscriptionRemainingCountdown(DAY + 1000), '1 siku imebaki');
assertEq('23 hours', formatSubscriptionRemainingCountdown(23 * HOUR + 30 * MIN), 'Masaa 23 yamebaki');
assertEq('59 minutes', formatSubscriptionRemainingCountdown(59 * MIN + 1000), 'Dakika 59 zimebaki');
assertEq('59 seconds', formatSubscriptionRemainingCountdown(59 * 1000), 'Sekunde 59 zimebaki');

const serverNow = Date.parse('2026-06-01T12:00:00.000Z');
const fetchedAt = serverNow - 5000;
const expiresAt = new Date(serverNow + 2 * DAY + 3 * HOUR).toISOString();
const remaining = getServerAnchoredRemainingMs({
  expiresAt,
  serverTime: new Date(serverNow).toISOString(),
  serverTimeFetchedAt: fetchedAt,
  nowMsOverride: serverNow + 5000,
});
assertEq(
  'server anchored 2d+',
  formatSubscriptionRemainingCountdown(remaining),
  '2 siku zimebaki',
);

const screen = fs.readFileSync(path.join(root, 'screens', 'AkauntiYanguScreen.js'), 'utf8');
if (!screen.includes('Muda Uliobaki wa Kifurushi')) {
  fail('account screen missing countdown label');
} else pass('account card label');
if (screen.includes('Channel Zilizofunguka')) {
  fail('old channel count label must be removed');
} else pass('channel count label removed');
if (!screen.includes('formatSubscriptionRemainingCountdown')) {
  fail('account screen must use countdown formatter');
} else pass('account screen uses formatter');

if (!process.exitCode) {
  console.log('\n[verify-subscription-remaining-countdown] ok');
}
