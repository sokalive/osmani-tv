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
assertEq('20 days', formatSubscriptionRemainingCountdown(20 * DAY), 'Siku 20 Zimebaki');
assertEq('5 days', formatSubscriptionRemainingCountdown(5 * DAY), 'Siku 5 Zimebaki');
assertEq('1 day', formatSubscriptionRemainingCountdown(DAY + 1000), 'Siku 1 Imebaki');
assertEq('23 hours', formatSubscriptionRemainingCountdown(23 * HOUR + 30 * MIN), 'Masaa 23 Yamebaki');
assertEq('2 hours', formatSubscriptionRemainingCountdown(2 * HOUR + 1000), 'Masaa 2 Yamebaki');
assertEq('1 hour', formatSubscriptionRemainingCountdown(HOUR + 1000), 'Saa 1 Imebaki');
assertEq('45 minutes', formatSubscriptionRemainingCountdown(45 * MIN + 1000), 'Dakika 45 Zimebaki');
assertEq('1 minute', formatSubscriptionRemainingCountdown(MIN + 1000), 'Dakika 1 Imebaki');
assertEq('30 seconds', formatSubscriptionRemainingCountdown(30 * 1000), 'Sekunde 30 Zimebaki');
assertEq('1 second', formatSubscriptionRemainingCountdown(1000), 'Sekunde 1 Imebaki');

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
  'Siku 2 Zimebaki',
);

const screen = fs.readFileSync(path.join(root, 'screens', 'AkauntiYanguScreen.js'), 'utf8');
if (!screen.includes('Muda Uliobaki wa Kifurushi')) {
  fail('account screen missing countdown label');
} else pass('account card label');
if (screen.includes('Channel Zilizofunguka')) {
  fail('old channel count label must be removed');
} else pass('channel count label removed');
if (!screen.includes('formatAccountRemainingDays')) {
  fail('account screen must use bounded calendar-day formatter');
} else pass('account screen uses bounded calendar-day formatter');

if (!process.exitCode) {
  console.log('\n[verify-subscription-remaining-countdown] ok');
}
