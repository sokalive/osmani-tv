#!/usr/bin/env node
'use strict';

/**
 * Probe production subscription + account display for specific device IDs.
 * Usage: DEVICE_IDS=id1,id2 node scripts/probe-device-subscription-verification.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VPS = (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');
const PACKAGE = 'com.burudanitv.app';
const LEGACY_PACKAGE = 'com.osmantv.app';

const DEVICE_IDS = (process.env.DEVICE_IDS || 'a05c6bbed811e16e,3C849B55163CF,58b32841ec6ae98')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function fingerprintFor(deviceId) {
  return crypto.createHash('sha256').update(`${deviceId}|${PACKAGE}|audit-probe`).digest('hex');
}

function pickNumber(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickActive(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.active === true || body.isActive === true) return true;
  const rem = pickNumber(body.remaining_seconds, body.remainingSeconds, body.remaining_days, body.remainingDays);
  if (rem != null && rem > 0) return true;
  const exp = body.expires_at ?? body.expiresAt;
  if (exp && Date.parse(String(exp)) > Date.now()) return true;
  return false;
}

function normalizePlanRow(raw) {
  const explicitlyInactive = raw?.is_active === false || raw?.isActive === false;
  const explicitlyActive = raw?.is_active === true || raw?.isActive === true;
  const hasIdentity =
    String(raw?.id ?? raw?.plan_id ?? '').trim() !== '' ||
    String(raw?.name ?? raw?.title ?? '').trim() !== '';
  const active = explicitlyActive || (!explicitlyInactive && hasIdentity);
  if (!active) return null;
  const id = String(raw?.id ?? raw?.plan_id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(raw?.name ?? raw?.title ?? '').trim(),
    price: pickNumber(raw?.price, raw?.amount) ?? 0,
    duration: pickNumber(raw?.duration_days, raw?.durationDays, raw?.duration, raw?.days),
  };
}

function normalizeVerify(body) {
  const sub = body?.subscription && typeof body.subscription === 'object' ? body.subscription : {};
  const data = body?.data && typeof body.data === 'object' ? body.data : {};
  const pay = body?.payment && typeof body.payment === 'object' ? body.payment : {};
  const plan = body?.plan && typeof body.plan === 'object' ? body.plan : {};
  const active = pickActive(body) || pickActive(sub) || pickActive(data);
  const expiresAt =
    body.expires_at ?? body.expiresAt ?? sub.expires_at ?? sub.expiresAt ?? data.expires_at ?? data.expiresAt ?? null;
  const remainingSeconds = pickNumber(
    body.remaining_seconds,
    body.remainingSeconds,
    sub.remaining_seconds,
    sub.remainingSeconds,
    data.remaining_seconds,
    data.remainingSeconds,
  );
  const remainingDays = pickNumber(
    body.remaining_days,
    body.remainingDays,
    sub.remaining_days,
    sub.remainingDays,
    data.remaining_days,
    data.remainingDays,
  );
  const planId = String(
    pay.plan_id ?? pay.planId ?? plan.id ?? body.plan_id ?? body.planId ?? sub.plan_id ?? '',
  ).trim() || null;
  const planName = String(
    plan.name ?? body.plan_name ?? body.planName ?? sub.plan_name ?? sub.planName ?? '',
  ).trim() || null;
  const amount = pickNumber(plan.price, body.amount, pay.amount, sub.amount);
  const planDurationDays = pickNumber(
    body.plan_duration_days,
    body.planDurationDays,
    plan.duration_days,
    plan.durationDays,
    sub.plan_duration_days,
  );
  const plans = Array.isArray(body.plans)
    ? body.plans
    : Array.isArray(data.plans)
      ? data.plans
      : [];
  return {
    active,
    expiresAt,
    remainingSeconds,
    remainingDays,
    planId,
    planName,
    amount,
    planDurationDays,
    plans,
    status: body.status ?? sub.status ?? data.status ?? null,
  };
}

function buildAccountUI(normalized, apiPlans) {
  const catalog = [
    ...(normalized.plans || []).map(normalizePlanRow).filter(Boolean),
    ...(apiPlans || []).map(normalizePlanRow).filter(Boolean),
  ];
  let planName = normalized.planName;
  let amount = normalized.amount;
  let duration = normalized.planDurationDays;
  if (normalized.planId) {
    const hit = catalog.find((p) => p.id === String(normalized.planId));
    if (hit) {
      if (!planName) planName = hit.name;
      if (!amount && hit.price) amount = hit.price;
      if (!duration && hit.duration) duration = hit.duration;
    }
  }
  if (!planName && catalog.length === 1) {
    planName = catalog[0].name;
    if (!amount) amount = catalog[0].price;
    if (!duration) duration = catalog[0].duration;
  }
  const paymentLabel =
    planName && amount != null
      ? `${planName} · TSh ${Number(amount).toLocaleString('en-US')}`
      : planName || null;
  return {
    accountStatus: normalized.active ? 'ACTIVE' : 'INACTIVE',
    paymentLabel: paymentLabel ?? '—',
    durationDays: duration != null ? String(duration) : '—',
    remainingDays:
      normalized.remainingDays != null
        ? normalized.remainingDays
        : normalized.remainingSeconds != null
          ? Math.max(0, Math.ceil(normalized.remainingSeconds / 86400))
          : null,
    expiresAt: normalized.expiresAt,
    cardsComplete: Boolean(planName && amount != null && duration != null),
    premiumUnlock: normalized.active === true,
    paymentDialog: normalized.active === true ? 'blocked' : 'would_show',
  };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text?.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, body };
}

function migrationPayload(deviceId) {
  const fp = fingerprintFor(deviceId);
  return {
    device_id: deviceId,
    device_fingerprint: fp,
    fingerprint: fp,
    android_id: deviceId,
    displayed_account_id: deviceId,
    current_device_id: deviceId,
    package_name: PACKAGE,
    legacy_package_name: LEGACY_PACKAGE,
    migration_bridge: true,
  };
}

async function probeDevice(deviceId, apiPlans) {
  const before = { phase: 'before_recover' };
  const after = { phase: 'after_recover' };

  const statusBefore = await fetchJson(
    `${VPS}/api/subscription-status?device_id=${encodeURIComponent(deviceId)}`,
  );
  before.status = statusBefore.body;
  before.statusActive = pickActive(statusBefore.body);

  const verifyBefore = await fetchJson(`${VPS}/api/subscription/verify`, {
    method: 'POST',
    body: JSON.stringify(migrationPayload(deviceId)),
  });
  before.verify = verifyBefore.body;
  before.verifyNormalized = normalizeVerify(verifyBefore.body || {});
  before.ui = buildAccountUI(before.verifyNormalized, apiPlans);

  const recover = await fetchJson(`${VPS}/api/subscription/recover`, {
    method: 'POST',
    body: JSON.stringify(migrationPayload(deviceId)),
  });
  after.recover = recover.body;
  const recoverAck =
    recover.body?.ok === true ||
    recover.body?.ok === 1 ||
    (recover.body?.recovered_from != null && String(recover.body.recovered_from).trim() !== '');

  const verifyAfter = await fetchJson(`${VPS}/api/subscription/verify`, {
    method: 'POST',
    body: JSON.stringify(migrationPayload(deviceId)),
  });
  after.verify = verifyAfter.body;
  after.verifyNormalized = normalizeVerify(verifyAfter.body || {});
  after.ui = buildAccountUI(after.verifyNormalized, apiPlans);
  after.recoverAck = recoverAck;

  const statusAfter = await fetchJson(
    `${VPS}/api/subscription-status?device_id=${encodeURIComponent(deviceId)}`,
  );
  after.status = statusAfter.body;
  after.statusActive = pickActive(statusAfter.body);

  let conclusion = 'No completed payment found';
  if (after.verifyNormalized.active) {
    conclusion = 'Valid payment and subscription restored';
  } else if (
    before.verifyNormalized.active ||
    (before.verifyNormalized.expiresAt && Date.parse(before.verifyNormalized.expiresAt) <= Date.now())
  ) {
    conclusion = 'Valid payment but subscription expired';
  } else if (recoverAck && after.verifyNormalized.active) {
    conclusion = 'Valid payment and subscription restored';
  }

  if (!after.verifyNormalized.active && !before.verifyNormalized.active) {
    const exp = after.verifyNormalized.expiresAt || before.verifyNormalized.expiresAt;
    if (exp && Date.parse(String(exp)) < Date.now()) {
      conclusion = 'Valid payment but subscription expired';
    }
  }

  return {
    deviceId,
    before: {
      statusActive: before.statusActive,
      verifyActive: before.verifyNormalized.active,
      ui: before.ui,
      expiresAt: before.verifyNormalized.expiresAt,
      status: before.status?.status ?? before.status?.active ?? null,
    },
    after: {
      recoverAck,
      recoverFrom: recover.body?.recovered_from ?? null,
      statusActive: after.statusActive,
      verifyActive: after.verifyNormalized.active,
      ui: after.ui,
      expiresAt: after.verifyNormalized.expiresAt,
    },
    clientSimulation: {
      reinstallRecovery: recoverAck || after.verifyNormalized.active,
      otaWouldReflect: after.ui.cardsComplete || after.verifyNormalized.active,
      cacheRefresh: after.verifyNormalized.active !== before.verifyNormalized.active ? 'state_changed' : 'stable',
    },
    conclusion,
  };
}

(async () => {
  const plansRes = await fetchJson(`${VPS}/api/plans`);
  const apiPlans = Array.isArray(plansRes.body) ? plansRes.body : plansRes.body?.plans ?? [];

  const results = [];
  for (const id of DEVICE_IDS) {
    console.log(`\n=== Probing ${id} ===`);
    const row = await probeDevice(id, apiPlans);
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  const outPath = path.join(__dirname, '..', 'device-subscription-verification-report.json');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log('\n[wrote]', outPath);
})();
