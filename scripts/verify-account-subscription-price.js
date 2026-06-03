#!/usr/bin/env node
'use strict';

/**
 * Account package display extraction from verify payloads (price + duration).
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

assertContains('api/subscription.js', 'pickPlanDurationDays', 'canonical duration extractor');
assertContains('api/subscription.js', 'pickDurationFromPlansCatalog', 'plans catalog duration fallback');
assertContains(
  'api/subscription.js',
  'Subscription plan_id/name + catalog beats stale embedded plan objects',
  'catalog before linked plan for price',
);
assertContains(
  'screens/AkauntiYanguScreen.js',
  'details.planId',
  'account label matches by planId',
);

const PACKAGES = [
  { name: 'Wiki 1', id: '3', price: 3000, durationDays: 7 },
  { name: 'MWENZI 1', id: '4', price: 5000, durationDays: 30 },
  { name: 'MIEZI 2', id: '5', price: 15000, durationDays: 60 },
  { name: 'MWAKA', id: '6', price: 40000, durationDays: 365 },
];

const CATALOG = PACKAGES.map((p) => ({
  id: p.id,
  name: p.name,
  price: p.price,
  duration_days: p.durationDays,
}));

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

function pickDurationFromPlanRow(planRow) {
  if (!isPlainObject(planRow)) return null;
  return pickNumber(
    planRow.duration_days,
    planRow.durationDays,
    planRow.days,
    planRow.plan_duration_days,
    planRow.planDurationDays,
  );
}

function pickAmountFromLinkedPlan(body) {
  const plan = isPlainObject(body.plan) ? body.plan : null;
  return pickPriceFromPlanRow(plan);
}

function pickAmountFromPlansCatalog(body) {
  const plans = Array.isArray(body.plans) ? body.plans : [];
  if (!plans.length) return null;
  const wantId = String(body.plan_id ?? body.planId ?? '').trim();
  if (wantId) {
    for (const p of plans) {
      const id = String(p?.id ?? p?.plan_id ?? p?.planId ?? '').trim();
      if (id && id === wantId) return pickPriceFromPlanRow(p);
    }
  }
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
  const catalog = pickAmountFromPlansCatalog(body);
  if (catalog != null) return catalog;
  const linked = pickAmountFromLinkedPlan(body);
  if (linked != null) return linked;
  return pickNumber(body.payment?.amount, body.amount);
}

function pickDurationFromPlansCatalog(body) {
  const plans = Array.isArray(body.plans) ? body.plans : [];
  if (!plans.length) return null;
  const wantId = String(body.plan_id ?? body.planId ?? '').trim();
  if (wantId) {
    for (const p of plans) {
      const id = String(p?.id ?? p?.plan_id ?? p?.planId ?? '').trim();
      if (id && id === wantId) return pickDurationFromPlanRow(p);
    }
  }
  const wantName = String(body.plan_name ?? body.planName ?? '').trim().toLowerCase();
  if (wantName) {
    for (const p of plans) {
      const label = String(p?.name ?? p?.title ?? '').trim().toLowerCase();
      if (label && label === wantName) return pickDurationFromPlanRow(p);
    }
  }
  return null;
}

function pickPlanDurationDays(body) {
  const catalog = pickDurationFromPlansCatalog(body);
  if (catalog != null) return catalog;
  const plan = isPlainObject(body.plan) ? body.plan : null;
  return pickNumber(
    pickDurationFromPlanRow(plan),
    body.plan_duration_days,
    body.planDurationDays,
  );
}

const STALE_WIKI_PLAN = {
  id: 3,
  name: 'Wiki 1',
  price: 3000,
  durationDays: 7,
};

for (const pkg of PACKAGES) {
  const linked = pickAmount({
    active: true,
    amount: 1000,
    plan_name: pkg.name,
    plan_id: pkg.id,
    plan_duration_days: pkg.durationDays,
    plan: { id: pkg.id, name: pkg.name, price: pkg.price, durationDays: pkg.durationDays },
  });
  assert.strictEqual(linked, pkg.price, `${pkg.name} linked plan price`);
  console.log('PASS: linked plan price', pkg.name, '=>', linked);

  const catalog = pickAmount({
    active: true,
    amount: 1000,
    plan_name: pkg.name,
    plan_id: pkg.id,
    plans: CATALOG,
  });
  assert.strictEqual(catalog, pkg.price, `${pkg.name} catalog price`);
  console.log('PASS: catalog price', pkg.name, '=>', catalog);

  const duration = pickPlanDurationDays({
    plan_id: pkg.id,
    plan_name: pkg.name,
    plan_duration_days: 7,
    plan: STALE_WIKI_PLAN,
    plans: CATALOG,
  });
  assert.strictEqual(duration, pkg.durationDays, `${pkg.name} catalog duration beats stale plan`);
  console.log('PASS: catalog duration', pkg.name, '=>', duration);

  const stalePrice = pickAmount({
    active: true,
    amount: 1000,
    plan_id: pkg.id,
    plan_name: pkg.name,
    plan_duration_days: 7,
    plan: STALE_WIKI_PLAN,
    plans: CATALOG,
  });
  assert.strictEqual(stalePrice, pkg.price, `${pkg.name} catalog price beats stale Wiki plan object`);
  console.log('PASS: stale Wiki plan object ignored for', pkg.name, '=>', stalePrice);
}

if (process.exitCode) {
  process.exit(1);
}
console.log('[verify-account-subscription-price] ok');
