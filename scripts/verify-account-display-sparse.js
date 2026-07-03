#!/usr/bin/env node
'use strict';

/**
 * Account cards must never show "—" when subscription is active with expiry/remaining.
 * Run: node scripts/verify-account-display-sparse.js
 */

const {
  enrichCanonicalSubscriptionTiming,
  resolveCanonicalExpiresAt,
  resolveDisplayDurationDays,
} = require('../lib/subscriptionCanonical');

function pass(msg) {
  console.log('PASS:', msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pickNumber(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function buildDisplay(details, subscriptionExpiresAt, catalog) {
  const expiresAt = resolveCanonicalExpiresAt(details, subscriptionExpiresAt);
  const base = details && typeof details === 'object' ? { ...details, expiresAt } : { expiresAt };
  const timed = enrichCanonicalSubscriptionTiming(base);
  const wantDuration = pickNumber(
    timed.displayDurationDays,
    timed.planDurationDays,
    timed.plan_duration_days,
  );
  if (wantDuration != null && catalog?.length) {
    const match = catalog.find((p) => Number(p.duration) === wantDuration);
    if (match) {
      return {
        ...timed,
        planName: timed.planName ?? match.name,
        amount: timed.amount ?? match.price,
        planDurationDays: timed.planDurationDays ?? wantDuration,
      };
    }
  }
  return timed;
}

function formatLabel(details, catalog) {
  const name = String(details?.planName ?? '').trim();
  const amount = pickNumber(details?.amount);
  if (name && amount) return `${name} · TSh ${amount.toLocaleString('en-US')}`;
  if (name) return name;
  const days = resolveDisplayDurationDays(details);
  if (days != null) return `${days} siku`;
  return null;
}

const CATALOG = [
  { id: '1', name: 'Wiki 1', price: 3000, duration: '7' },
  { id: '2', name: 'Mwezi 1', price: 10000, duration: '30' },
];

const sparseVerify = {
  active: true,
  expiresAt: '2026-07-10T12:00:00.000Z',
  remainingSeconds: 6 * 24 * 60 * 60,
};

const displaySparse = buildDisplay(sparseVerify, sparseVerify.expiresAt, CATALOG);
const labelSparse = formatLabel(displaySparse, CATALOG);
const durationSparse = resolveDisplayDurationDays(displaySparse);

if (!labelSparse) fail(`sparse verify must show package label, got ${labelSparse}`);
else pass(`sparse verify label: ${labelSparse}`);

if (durationSparse == null) fail('sparse verify must resolve duration days');
else pass(`sparse verify duration: ${durationSparse} days`);

const displayTop = buildDisplay(
  { ...sparseVerify, expiresAt: null },
  sparseVerify.expiresAt,
  CATALOG,
);
if (resolveDisplayDurationDays(displayTop) == null) {
  fail('top-level expiresAt must feed duration card');
} else pass('top-level expiry feeds duration card');

for (const days of [1, 2, 3, 7, 30, 60, 365]) {
  const hint = {
    expiresAt: '2026-08-01T00:00:00.000Z',
    remainingSeconds: days * 86400,
  };
  const catalog = [{ id: `p-${days}`, name: `${days} Day Pack`, price: days * 1000, duration: String(days) }];
  const built = buildDisplay(hint, hint.expiresAt, catalog);
  if (!formatLabel(built, catalog)) fail(`${days}-day package label missing`);
  if (resolveDisplayDurationDays(built) !== days) {
    fail(`${days}-day duration mismatch`);
  }
}
pass('all standard package durations render');

if (!process.exitCode) {
  console.log('\n[verify-account-display-sparse] ok');
}
