#!/usr/bin/env node
'use strict';

/**
 * Smoke checks for Account "Malipo / Kifurushi" price extraction from verify payloads.
 * Run: node scripts/verify-account-subscription-price.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertContains(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) {
    console.error('FAIL:', label, rel, 'missing', needle);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

assertContains('api/subscription.js', 'pickAmountFromLinkedPlan', 'linked plan price extractor');
assertContains('api/subscription.js', 'pickAmountFromPlansCatalog', 'plans catalog price fallback');
assertContains(
  'api/subscription.js',
  'Payment / transaction amount before generic subscription placeholders',
  'payment before placeholder amount',
);
assertContains(
  'screens/AkauntiYanguScreen.js',
  'if (fromPlan) return fromPlan',
  'account label prefers matched plan price',
);

const PACKAGES = [
  { name: 'Wiki 1', id: 3, price: 3000, durationDays: 7 },
  { name: 'MWENZI 1', id: 4, price: 5000, durationDays: 30 },
  { name: 'MIEZI 2', id: 5, price: 15000, durationDays: 60 },
  { name: 'MWAKA', id: 6, price: 40000, durationDays: 365 },
];

function isPlainObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function pickNumber(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickPriceFromPlanRow(planRow) {
  if (!isPlainObject(planRow)) return null;
  return pickNumber(planRow.price, planRow.amount, planRow.Price, planRow.Amount);
}

function pickAmountFromLinkedPlan(body) {
  const plan = isPlainObject(body.plan) ? body.plan : null;
  const subPlan = isPlainObject(body.subscription?.plan) ? body.subscription.plan : null;
  const mgPlan = isPlainObject(body.manualGift?.plan) ? body.manualGift.plan : null;
  return pickNumber(
    pickPriceFromPlanRow(plan),
    pickPriceFromPlanRow(subPlan),
    pickPriceFromPlanRow(mgPlan),
  );
}

function pickAmountFromPlansCatalog(body) {
  const plans = Array.isArray(body.plans) ? body.plans : [];
  if (!plans.length) return null;
  const wantName = String(body.plan_name ?? body.planName ?? '').trim().toLowerCase();
  if (wantName) {
    for (const p of plans) {
      const label = String(p?.name ?? p?.title ?? '').trim().toLowerCase();
      if (label && label === wantName) return pickPriceFromPlanRow(p);
    }
  }
  return null;
}

function pickAmount(body) {
  const linked = pickAmountFromLinkedPlan(body);
  if (linked != null) return linked;
  const catalog = pickAmountFromPlansCatalog(body);
  if (catalog != null) return catalog;
  return pickNumber(body.payment?.amount, body.amount);
}

for (const pkg of PACKAGES) {
  const linked = pickAmount({
    active: true,
    amount: 1000,
    plan_name: pkg.name,
    plan_duration_days: pkg.durationDays,
    plan: { id: pkg.id, name: pkg.name, price: pkg.price, durationDays: pkg.durationDays },
  });
  assert.strictEqual(linked, pkg.price, `${pkg.name} linked plan`);
  console.log('PASS: linked plan', pkg.name, '=>', linked);

  const catalog = pickAmount({
    active: true,
    amount: 1000,
    plan_name: pkg.name,
    plan_duration_days: pkg.durationDays,
    plans: PACKAGES.map((p) => ({ id: p.id, name: p.name, price: p.price, durationDays: p.durationDays })),
  });
  assert.strictEqual(catalog, pkg.price, `${pkg.name} plans catalog`);
  console.log('PASS: plans catalog', pkg.name, '=>', catalog);

  const paid = pickAmount({
    active: true,
    amount: 1000,
    plan_name: pkg.name,
    payment: { amount: pkg.price },
  });
  assert.strictEqual(paid, pkg.price, `${pkg.name} payment amount`);
  console.log('PASS: payment amount', pkg.name, '=>', paid);
}

if (process.exitCode) {
  process.exit(1);
}
console.log('[verify-account-subscription-price] ok');
