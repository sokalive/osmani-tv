#!/usr/bin/env node
'use strict';

/**
 * Production audit — every ACTIVE device must resolve Account card fields.
 *
 * Usage:
 *   DEVICE_IDS=id1,id2,id3 node scripts/audit-account-display-production.js
 *   DEVICE_IDS_FILE=./active-devices.txt node scripts/audit-account-display-production.js
 *
 * Optional:
 *   EXPO_PUBLIC_API_URL=https://api.osmanitv.com
 *   DEVICE_FINGERPRINT=shared-fp-for-probes
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VPS = (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');
const PACKAGE = 'com.burudanitv.app';
const LEGACY_PACKAGE = 'com.osmantv.app';

function loadDeviceIds() {
  const fromEnv = (process.env.DEVICE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const file = process.env.DEVICE_IDS_FILE;
  if (file && fs.existsSync(file)) {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  return [];
}

function fingerprintFor(deviceId) {
  if (process.env.DEVICE_FINGERPRINT) return process.env.DEVICE_FINGERPRINT;
  return crypto.createHash('sha256').update(`${deviceId}|${PACKAGE}|audit-probe`).digest('hex');
}

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

function pickActive(body) {
  if (!isPlainObject(body)) return false;
  if (body.active === true || body.isActive === true) return true;
  const rem = pickNumber(body.remaining_seconds, body.remainingSeconds);
  if (rem != null && rem > 0) return true;
  const exp = body.expires_at ?? body.expiresAt;
  if (exp && Date.parse(String(exp)) > Date.now()) return true;
  return false;
}

/** Mirror lib/paymentPlansCache.js lenient normalization (post-5e736b9). */
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
    duration: pickNumber(
      raw?.duration_days,
      raw?.durationDays,
      raw?.duration,
      raw?.days,
    ),
  };
}

function normalizePlans(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(normalizePlanRow).filter(Boolean);
}

function findCatalogPlan(details, catalog) {
  if (!catalog.length) return null;
  const wantId = String(details.planId ?? details.plan_id ?? '').trim();
  if (wantId) {
    const byId = catalog.find((p) => p.id === wantId);
    if (byId) return byId;
  }
  const wantName = String(details.planName ?? details.plan_name ?? '')
    .trim()
    .toLowerCase();
  if (wantName) {
    const byName = catalog.find((p) => p.name.toLowerCase() === wantName);
    if (byName) return byName;
  }
  const wantDur = pickNumber(details.planDurationDays, details.plan_duration_days, details.displayDurationDays);
  if (wantDur != null) {
    const byDur = catalog.filter((p) => p.duration === wantDur);
    if (byDur.length === 1) return byDur[0];
  }
  return catalog.length === 1 ? catalog[0] : null;
}

function buildAccountCards(normalized, rawBody, apiPlans) {
  const catalog = normalizePlans([
    ...(Array.isArray(normalized.plans) ? normalized.plans : []),
    ...(Array.isArray(rawBody?.plans) ? rawBody.plans : []),
    ...apiPlans,
  ]);

  const details = {
    planId: normalized.planId ?? null,
    planName: normalized.planName ?? null,
    amount: normalized.amount ?? null,
    currency: normalized.currency ?? 'TZS',
    planDurationDays: normalized.planDurationDays ?? null,
    expiresAt: normalized.expiresAt ?? null,
    remainingSeconds: normalized.remainingSeconds ?? normalized.remaining_seconds ?? null,
    plans: catalog,
  };

  const plan = findCatalogPlan(details, catalog);
  if (plan) {
    if (!details.planName) details.planName = plan.name;
    if (!details.amount && plan.price > 0) details.amount = plan.price;
    if (!details.planDurationDays && plan.duration) details.planDurationDays = plan.duration;
  }

  const name = String(details.planName ?? '').trim();
  const amount = details.amount;
  let paymentLabel = null;
  if (name && amount != null) {
    paymentLabel = `${name} · TSh ${Number(amount).toLocaleString('en-US')}`;
  } else if (name) {
    paymentLabel = name;
  }

  const durationDays = details.planDurationDays ?? null;

  return {
    paymentLabel,
    durationDays,
    catalogCount: catalog.length,
    missing: {
      planName: !name,
      amount: amount == null,
      duration: durationDays == null,
    },
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
    body = { _raw: text?.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, body };
}

async function postVerify(deviceId) {
  const fp = fingerprintFor(deviceId);
  return fetchJson(`${VPS}/api/subscription/verify`, {
    method: 'POST',
    body: JSON.stringify({
      device_id: deviceId,
      device_fingerprint: fp,
      fingerprint: fp,
      android_id: deviceId,
      displayed_account_id: deviceId,
      package_name: PACKAGE,
      legacy_package_name: LEGACY_PACKAGE,
      migration_bridge: true,
    }),
  });
}

function normalizeVerifyBody(body) {
  if (!isPlainObject(body)) return {};
  return {
    active: pickActive(body),
    planId: body.planId ?? body.plan_id ?? null,
    planName: body.planName ?? body.plan_name ?? null,
    amount: body.amount ?? null,
    currency: body.currency ?? null,
    planDurationDays: body.planDurationDays ?? body.plan_duration_days ?? null,
    expiresAt: body.expiresAt ?? body.expires_at ?? null,
    remainingSeconds: body.remainingSeconds ?? body.remaining_seconds ?? null,
    plans: Array.isArray(body.plans) ? body.plans : [],
  };
}

async function main() {
  const deviceIds = loadDeviceIds();
  console.log('[audit-account-display-production] VPS', VPS);
  console.log('[audit-account-display-production] devices', deviceIds.length);

  const plansRes = await fetchJson(`${VPS}/api/plans`);
  const apiPlans = Array.isArray(plansRes.body) ? plansRes.body : [];
  const catalogNormalized = normalizePlans(apiPlans);
  console.log('[audit-account-display-production] api plans catalog', catalogNormalized.length);

  if (!deviceIds.length) {
    console.error(
      'FAIL: no DEVICE_IDS or DEVICE_IDS_FILE — provide active subscriber device IDs from Admin for population audit',
    );
    process.exitCode = 1;
    return;
  }

  const report = {
    timestamp: new Date().toISOString(),
    vps: VPS,
    catalogPlans: catalogNormalized.length,
    devices: [],
    activeChecked: 0,
    activeComplete: 0,
    activeIncomplete: 0,
  };

  for (const deviceId of deviceIds) {
    const status = await fetchJson(
      `${VPS}/api/subscription-status?device_id=${encodeURIComponent(deviceId)}`,
    );
    const verify = await postVerify(deviceId);
    const norm = normalizeVerifyBody(verify.body);
    const active = norm.active || pickActive(status.body);

    const row = {
      deviceId: deviceId.slice(0, 8) + '…',
      active,
      verifyHttp: verify.status,
      verifyPlanId: norm.planId,
      verifyPlanName: norm.planName,
      verifyAmount: norm.amount,
      verifyDuration: norm.planDurationDays,
      verifyPlansInPayload: norm.plans.length,
      expiresAt: norm.expiresAt,
      remainingSeconds: norm.remainingSeconds,
    };

    if (active) {
      report.activeChecked += 1;
      const cards = buildAccountCards(norm, verify.body, apiPlans);
      row.paymentLabel = cards.paymentLabel;
      row.durationDays = cards.durationDays;
      row.catalogResolved = cards.catalogCount;
      row.cardMissing = cards.missing;

      const incomplete =
        cards.missing.planName || cards.missing.amount || cards.missing.duration;
      if (incomplete) {
        report.activeIncomplete += 1;
        row.pass = false;
        console.error('FAIL ACTIVE', row.deviceId, JSON.stringify(row));
      } else {
        report.activeComplete += 1;
        row.pass = true;
        console.log('PASS ACTIVE', row.deviceId, row.paymentLabel, 'duration', row.durationDays);
      }
    } else {
      row.pass = null;
      row.skipped = 'inactive';
      console.log('SKIP inactive', row.deviceId);
    }

    report.devices.push(row);
  }

  console.log('\n[audit-account-display-production] summary', JSON.stringify({
    activeChecked: report.activeChecked,
    activeComplete: report.activeComplete,
    activeIncomplete: report.activeIncomplete,
  }));

  if (report.activeIncomplete > 0) process.exitCode = 1;

  const outPath = path.join(__dirname, '..', 'audit-account-display-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('[audit-account-display-production] wrote', outPath);
}

main().catch((e) => {
  console.error('FAIL:', e?.message ?? e);
  process.exitCode = 1;
});
