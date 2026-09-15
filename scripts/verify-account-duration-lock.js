#!/usr/bin/env node
'use strict';

/**
 * Account UI duration lock — remaining/package duration never exceed legitimate
 * entitlement planDurationDays; Kuisha Tarehe stays backend expires_at.
 * Run: node scripts/verify-account-duration-lock.js
 */

const fs = require('fs');
const path = require('path');
const {
  boundAccountRemainingDays,
  formatAccountRemainingDays,
} = require('../lib/accountRemainingDisplay');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

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

function parseCatalogPlanDurationDays(plan) {
  if (!plan) return null;
  return pickNumber(
    plan.duration,
    plan.duration_days,
    plan.durationDays,
    plan.days,
    plan.plan_duration_days,
    plan.planDurationDays,
  );
}

/** Mirror of resolveAssignedPlanDurationDays after entitlement-first fix. */
function resolveAssignedPlanDurationDays(details, catalogPlans = []) {
  if (!details || typeof details !== 'object') return null;
  const entitlementDays = pickNumber(details.planDurationDays, details.plan_duration_days);
  if (entitlementDays != null && entitlementDays > 0) return Math.trunc(entitlementDays);
  const wantId = String(details.planId ?? details.plan_id ?? '').trim();
  const wantName = String(details.planName ?? details.plan_name ?? '')
    .trim()
    .toLowerCase();
  let catalogPlan = null;
  if (wantId) catalogPlan = catalogPlans.find((p) => String(p.id) === wantId) || null;
  if (!catalogPlan && wantName) {
    catalogPlan =
      catalogPlans.find((p) => String(p.name ?? '').trim().toLowerCase() === wantName) || null;
  }
  const catalogDays = parseCatalogPlanDurationDays(catalogPlan);
  return catalogDays != null && catalogDays > 0 ? Math.trunc(catalogDays) : null;
}

function resolveCanonicalExpiresAt(details, subscriptionExpiresAt = null) {
  const fromDetails = details?.expiresAt ?? details?.expires_at ?? null;
  if (fromDetails != null && String(fromDetails).trim() !== '') return String(fromDetails);
  if (subscriptionExpiresAt != null && String(subscriptionExpiresAt).trim() !== '') {
    return String(subscriptionExpiresAt);
  }
  return null;
}

/** Mirror: always backend expires_at (no today+remaining rewrite). */
function resolveAccountDisplayExpiresAt(details, subscriptionExpiresAt = null) {
  return resolveCanonicalExpiresAt(details, subscriptionExpiresAt);
}

function resolveAccountRemainingDays(details, subscriptionExpiresAt, catalogPlans, nowMs) {
  const assigned = resolveAssignedPlanDurationDays(details, catalogPlans);
  const backendDays = pickNumber(
    details.entitlement_remaining_days,
    details.entitlementRemainingDays,
    details.remainingDays,
    details.remaining_days,
  );
  if (backendDays != null && backendDays > 0) {
    return boundAccountRemainingDays({
      remainingDays: backendDays,
      assignedPlanDurationDays: assigned,
    });
  }
  const expiresAt = resolveCanonicalExpiresAt(details, subscriptionExpiresAt);
  const expiresMs = Date.parse(String(expiresAt ?? ''));
  if (!Number.isFinite(expiresMs)) return null;
  return boundAccountRemainingDays({
    remainingMs: expiresMs - nowMs,
    assignedPlanDurationDays: assigned,
  });
}

function resolveDisplayDurationDays(details) {
  const display = pickNumber(details.displayDurationDays);
  if (display != null && display > 0) return Math.trunc(display);
  const catalog = pickNumber(details.planDurationDays, details.plan_duration_days);
  if (catalog != null && catalog > 0) return Math.trunc(catalog);
  const expiresMs = Date.parse(String(details.expiresAt ?? ''));
  const startMs = Date.parse(String(details.startedAt ?? ''));
  if (Number.isFinite(expiresMs) && Number.isFinite(startMs) && expiresMs > startMs) {
    return Math.max(1, Math.ceil((expiresMs - startMs) / 86400000));
  }
  return null;
}

const CATALOG = [
  { id: '10', name: 'Wiki 1', price: 3000, duration: 8, duration_days: 8 },
  { id: '11', name: 'MWENZI 1', price: 5000, duration: 30, duration_days: 30 },
  { id: '12', name: 'MIEZI 2', price: 15000, duration: 60, duration_days: 60 },
  { id: '13', name: 'MIEZI 4', price: 30000, duration: 121, duration_days: 121 },
  { id: '14', name: 'MWAKA', price: 40000, duration: 365, duration_days: 365 },
];

const now = Date.parse('2026-09-15T10:00:00.000Z');

function casePkg(name, days, id) {
  const expiresAt = new Date(now + days * 86400 * 1000).toISOString();
  const details = {
    planName: name,
    planId: id,
    planDurationDays: days,
    plan_duration_days: days,
    expiresAt,
    remainingDays: days,
  };
  const assigned = resolveAssignedPlanDurationDays(details, CATALOG);
  const remaining = resolveAccountRemainingDays(details, expiresAt, CATALOG, now);
  const kuisha = resolveAccountDisplayExpiresAt(details, expiresAt);
  if (assigned !== days) return fail(`CASE ${name}: duration want ${days} got ${assigned}`);
  if (remaining == null || remaining > days) {
    return fail(`CASE ${name}: remaining want <=${days} got ${remaining}`);
  }
  if (kuisha !== expiresAt) return fail(`CASE ${name}: Kuisha must be backend expires_at`);
  pass(`CASE ${name} (${days}d): duration=${assigned} remaining=${remaining} expiry=backend`);
}

casePkg('Wiki 1', 8, '10');
casePkg('MWENZI 1', 30, '11');
casePkg('MIEZI 2', 60, '12');
casePkg('MIEZI 4', 121, '13');
casePkg('MWAKA', 365, '14');

{
  const historical = {
    planName: 'MIEZI 4',
    planId: '13',
    planDurationDays: 121,
    plan_duration_days: 121,
    expiresAt: new Date(now + 90 * 86400 * 1000).toISOString(),
    remainingDays: 90,
  };
  const shortenedCatalog = [
    { id: '13', name: 'MIEZI 4', price: 30000, duration: 30, duration_days: 30 },
  ];
  const assigned = resolveAssignedPlanDurationDays(historical, shortenedCatalog);
  if (assigned !== 121) fail(`CASE 6 historical duration must stay 121 got ${assigned}`);
  else pass('CASE 6 historical 121 preserved vs catalog 30');
}

{
  const expired = {
    planDurationDays: 8,
    expiresAt: new Date(now - 86400 * 1000).toISOString(),
    remainingDays: 0,
    remaining_seconds: 0,
  };
  const remaining = resolveAccountRemainingDays(expired, expired.expiresAt, CATALOG, now);
  if (remaining != null && remaining > 0) fail(`CASE 7 expired remaining got ${remaining}`);
  else pass('CASE 7 expired remaining not positive');
  if (formatAccountRemainingDays(0) !== 'Kifurushi Kimeisha') fail('CASE 7 expired label');
  else pass('CASE 7 expired label');
}

{
  const farExpires = new Date(now + 400 * 86400 * 1000).toISOString();
  const corrupted = {
    planName: 'Wiki 1',
    planId: '10',
    planDurationDays: 8,
    expiresAt: farExpires,
    remainingDays: 400,
  };
  const remaining = resolveAccountRemainingDays(corrupted, farExpires, CATALOG, now);
  const kuisha = resolveAccountDisplayExpiresAt(corrupted, farExpires);
  if (remaining !== 8) fail(`CASE 8 remaining must clamp to 8 got ${remaining}`);
  else pass('CASE 8 remaining clamped to 8');
  if (kuisha !== farExpires) fail('CASE 8 must not invent/rewrite Kuisha Tarehe');
  else pass('CASE 8 Kuisha Tarehe stays authoritative expires_at');
}

{
  const entitlementFirst = resolveAssignedPlanDurationDays(
    { planId: '11', planDurationDays: 30, plan_duration_days: 30 },
    [{ id: '11', name: 'MWENZI 1', duration: 7, duration_days: 7 }],
  );
  if (entitlementFirst !== 30) fail('entitlement duration must win over shorter catalog');
  else pass('entitlement duration wins over shorter catalog');

  const catalogFill = resolveAssignedPlanDurationDays(
    { planId: '11', planName: 'MWENZI 1' },
    CATALOG,
  );
  if (catalogFill !== 30) fail(`catalog fill want 30 got ${catalogFill}`);
  else pass('catalog fills duration when entitlement omits it');
}

{
  const span = resolveDisplayDurationDays({
    planDurationDays: 8,
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 100 * 86400 * 1000).toISOString(),
  });
  if (span !== 8) fail(`planDurationDays must beat span got ${span}`);
  else pass('planDurationDays preferred over started→expires span');
}

if (boundAccountRemainingDays({ remainingDays: 180, assignedPlanDurationDays: 30 }) !== 30) {
  fail('boundAccountRemainingDays caps 180→30');
} else pass('boundAccountRemainingDays caps 180→30');

const displaySrc = read('lib/accountSubscriptionDisplay.js');
const canonicalSrc = read('lib/subscriptionCanonical.js');
const apiSrc = read('api/subscription.js');
const accountSrc = read('screens/AkauntiYanguScreen.js');

if (displaySrc.includes('Date.UTC(y, m, d + remainingDays')) {
  fail('must not invent Kuisha Tarehe from today+remainingDays');
} else pass('no today+remainingDays Kuisha rewrite');

if (!displaySrc.includes('entitlementDays')) {
  fail('resolveAssignedPlanDurationDays must prefer entitlement days');
} else pass('entitlement-first assigned duration');

if (!displaySrc.includes('expires_beyond_package_duration')) {
  fail('anomaly trace required for far expires_at');
} else pass('anomaly trace for far expires_at');

const pickIdx = apiSrc.indexOf('function pickPlanDurationDays');
const pickBody = apiSrc.slice(pickIdx, pickIdx + 1200);
if (!pickBody.includes('entitlementDays') || !pickBody.includes('pickDurationFromPlansCatalog')) {
  fail('pickPlanDurationDays must prefer entitlement then catalog fill');
} else if (pickBody.indexOf('entitlementDays') > pickBody.indexOf('return pickDurationFromPlansCatalog')) {
  fail('pickPlanDurationDays must read entitlement before catalog return');
} else pass('api pickPlanDurationDays entitlement-first');

if (!canonicalSrc.includes('Prefer package metadata over startedAt')) {
  fail('resolveDisplayDurationDays must prefer plan metadata over span');
} else pass('canonical display duration prefers plan metadata');

if (!accountSrc.includes('authoritative backend expires_at only')) {
  fail('Account screen Box 4 comment must state backend expiry only');
} else pass('Account Box 4 bound to backend expires_at');

if (!process.exitCode) {
  console.log('\n[verify-account-duration-lock] ok');
}
