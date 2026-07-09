#!/usr/bin/env node
'use strict';

/**
 * OMBA KIFURUSHI plan duplication regression — canonical plan ID dedupe.
 * Run: node scripts/verify-omba-kifurushi-plans-dedup.js
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

const cacheSrc = read('lib/paymentPlansCache.js');
const modalSrc = read('components/OmbaKifurushiModal.js');

if (!cacheSrc.includes('seenIds.has(plan.id)')) {
  fail('normalizePaymentPlansList must dedupe by canonical plan id');
} else pass('canonical plan id dedupe in normalizePaymentPlansList');

if (modalSrc.includes('[...fromContext, ...cached, ...hydrated, ...fresh]')) {
  fail('OmbaKifurushiModal must not concatenate all plan sources');
} else pass('OmbaKifurushiModal no multi-source concat');

if (!modalSrc.includes("refreshPaymentPlansCache({ reason: 'omba-kifurushi' })")) {
  fail('OmbaKifurushiModal must refresh plans cache');
} else pass('OmbaKifurushiModal refreshPaymentPlansCache');

// Mirror normalizePaymentPlansList + normalizePaymentPlanRow
function normalizePaymentPlanRow(raw) {
  const explicitlyInactive = raw?.is_active === false || raw?.isActive === false;
  const explicitlyActive = raw?.is_active === true || raw?.isActive === true;
  const hasIdentity =
    String(raw?.id ?? raw?.plan_id ?? '').trim() !== '' ||
    String(raw?.name ?? raw?.title ?? '').trim() !== '';
  const active = explicitlyActive || (!explicitlyInactive && hasIdentity);
  return {
    id: String(raw?.id ?? raw?.plan_id ?? '').trim(),
    name: String(raw?.name ?? raw?.title ?? '').trim(),
    price: Number(raw?.price ?? raw?.amount ?? 0),
    duration: String(
      raw?.duration_days ??
        raw?.durationDays ??
        raw?.days ??
        raw?.duration ??
        '',
    ).trim(),
    isActive: active,
  };
}

function normalizePaymentPlansList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const seenIds = new Set();
  for (const raw of rawList) {
    const plan = normalizePaymentPlanRow(raw);
    if (!plan.isActive || !plan.id) continue;
    if (seenIds.has(plan.id)) continue;
    seenIds.add(plan.id);
    out.push(plan);
  }
  return out;
}

const plan1 = { id: 3, name: 'Wiki 1', duration_days: 7, price: 3000 };
const plan2 = { id: 4, name: 'MWENZI 1', duration_days: 30, price: 5000 };
const plan3 = { id: 5, name: 'MIEZI 2', duration_days: 60, price: 15000 };
const plan4 = { id: 6, name: 'MWAKA', duration_days: 365, price: 40000 };
const catalog = [plan1, plan2, plan3, plan4];

// 1. API returns 4 unique plans
if (normalizePaymentPlansList(catalog).length !== 4) fail('case 1: four unique plans');
else pass('case 1: API 4 unique → modal 4');

// 2. Same payload twice
const twice = normalizePaymentPlansList([...catalog, ...catalog]);
if (twice.length !== 4) fail('case 2: duplicate payload still 4');
else pass('case 2: same payload twice → 4');

// 3. Cache + network same 4
const cacheNet = normalizePaymentPlansList([...catalog, ...catalog.map((p) => ({ ...p }))]);
if (cacheNet.length !== 4) fail('case 3: cache+network → 4');
else pass('case 3: cache + network same 4 → 4');

// 4. Modal open simulation (5 merges)
let openResult = [];
for (let i = 0; i < 5; i++) {
  openResult = normalizePaymentPlansList([...openResult, ...catalog]);
}
if (openResult.length !== 4) fail('case 4: reopen 5x → 4');
else pass('case 4: modal opened 5 times → 4');

// 8. Same price, different ids
const samePrice = normalizePaymentPlansList([
  { id: 10, name: 'A', duration_days: 7, price: 5000 },
  { id: 11, name: 'B', duration_days: 30, price: 5000 },
]);
if (samePrice.length !== 2) fail('case 8: same price both remain');
else pass('case 8: same price different ids → both remain');

// 9. Same duration, different ids
const sameDur = normalizePaymentPlansList([
  { id: 12, name: 'X', duration_days: 30, price: 3000 },
  { id: 13, name: 'Y', duration_days: 30, price: 5000 },
]);
if (sameDur.length !== 2) fail('case 9: same duration both remain');
else pass('case 9: same duration different ids → both remain');

// 10. Similar names, different ids
const similar = normalizePaymentPlansList([
  { id: 14, name: 'Wiki 1', duration_days: 7, price: 3000 },
  { id: 15, name: 'Wiki 1', duration_days: 7, price: 3000 },
]);
if (similar.length !== 2) fail('case 10: similar names different ids');
else pass('case 10: similar names different ids → both remain');

// 11. True duplicate canonical id
const dup = normalizePaymentPlansList([
  { id: 3, name: 'Wiki 1', duration_days: 7, price: 3000 },
  { id: 3, name: 'Wiki 1 copy', duration_days: 7, price: 3000 },
]);
if (dup.length !== 1 || dup[0].name !== 'Wiki 1') fail('case 11: duplicate id once');
else pass('case 11: duplicate canonical id → one entry, first wins');

// 12. Selection id preserved
if (dup[0].id !== '3') fail('case 12: canonical id preserved');
else pass('case 12: canonical plan id preserved');

// 14. Order stable (first occurrence)
const ordered = normalizePaymentPlansList([plan2, plan1, plan2, plan3]);
if (ordered.map((p) => p.id).join(',') !== '4,3,5') fail('case 14: order stable');
else pass('case 14: first valid occurrence order preserved');

if (process.exitCode) process.exit(1);
console.log('\n[verify-omba-kifurushi-plans-dedup] ok');
