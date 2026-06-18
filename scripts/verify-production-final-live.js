#!/usr/bin/env node
'use strict';

/**
 * Live production verification — payment + subscription parity (Render legacy vs Contabo VPS).
 *
 * Usage:
 *   node scripts/verify-production-final-live.js
 *   DEVICE_IDS=0523d797b3197a0f,abc123 node scripts/verify-production-final-live.js
 *
 * Optional env:
 *   DEVICE_FINGERPRINT — shared fingerprint for all DEVICE_IDS
 *   PAYMENT_TEST_PHONE — if set, probes create-order (no PIN; does not complete payment)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RENDER = 'https://osmani-admin-api.onrender.com';
const CONTABO = 'http://144.91.117.90:10001';
const PACKAGE = 'com.burudanitv.app';
const RUNTIME = '1.7.2';
const OTA_COMMIT = '4975fd7';

const DEFAULT_DEVICES = ['0523d797b3197a0f'];
const DEVICE_IDS = (process.env.DEVICE_IDS || DEFAULT_DEVICES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function isPlainObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function pickActive(body) {
  if (!isPlainObject(body)) return false;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const candidates = [
    body.active,
    body.is_active,
    body.isActive,
    body.has_subscription,
    body.hasSubscription,
    data?.active,
    data?.has_subscription,
    sub?.active,
    sub?.has_subscription,
  ];
  for (const c of candidates) {
    if (c === true || c === 1 || c === '1' || c === 'true') return true;
    if (c === false || c === 0 || c === '0' || c === 'false') return false;
  }
  const st = String(body.status ?? data?.status ?? sub?.status ?? '').toLowerCase();
  if (['active', 'paid', 'live', 'ok'].includes(st)) return true;
  const rem = Number(
    body.remaining_seconds ??
      body.remainingSeconds ??
      data?.remaining_seconds ??
      data?.remainingSeconds ??
      0,
  );
  return Number.isFinite(rem) && rem > 0;
}

function pickExpiresAt(body) {
  if (!isPlainObject(body)) return null;
  const v =
    body.expires_at ??
    body.expiresAt ??
    body.data?.expires_at ??
    body.data?.expiresAt ??
    body.subscription?.expires_at ??
    body.subscription?.expiresAt ??
    null;
  return v != null ? String(v) : null;
}

function pickPlanName(body) {
  if (!isPlainObject(body)) return null;
  return (
    body.plan_name ??
    body.planName ??
    body.plan?.name ??
    body.data?.plan_name ??
    body.data?.planName ??
    null
  );
}

function fingerprintFor(deviceId) {
  if (process.env.DEVICE_FINGERPRINT) return process.env.DEVICE_FINGERPRINT;
  return crypto.createHash('sha256').update(`${deviceId}|${PACKAGE}|verify-prod`).digest('hex');
}

async function fetchJson(base, pathSuffix, opts = {}) {
  const url = `${base}${pathSuffix}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    ...(opts.body != null ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { url, status: res.status, ok: res.ok, ms: Date.now() - started, parsed, text };
}

async function simulateClientRecoveryChain(base, deviceId, fp, label) {
  const verify = await fetchJson(base, '/api/subscription/verify', {
    method: 'POST',
    body: { device_id: deviceId, device_fingerprint: fp, fingerprint: fp },
  });
  let active = pickActive(verify.parsed);
  let expiresAt = pickExpiresAt(verify.parsed);
  let planName = pickPlanName(verify.parsed);
  let pathUsed = 'verify';

  if (!active) {
    const recover = await fetchJson(base, '/api/subscription/recover', {
      method: 'POST',
      body: { device_id: deviceId, device_fingerprint: fp, fingerprint: fp },
    });
    const recoverAck =
      recover.parsed?.ok === true || recover.parsed?.recovered_from != null;
    if (recoverAck && !pickActive(recover.parsed)) {
      const reverify = await fetchJson(base, '/api/subscription/verify', {
        method: 'POST',
        body: { device_id: deviceId, device_fingerprint: fp, fingerprint: fp },
      });
      if (pickActive(reverify.parsed)) {
        active = true;
        expiresAt = pickExpiresAt(reverify.parsed);
        planName = pickPlanName(reverify.parsed);
        pathUsed = 'recover→verify';
      } else {
        const status = await fetchJson(
          base,
          `/api/subscription-status?device_id=${encodeURIComponent(deviceId)}`,
        );
        if (pickActive(status.parsed)) {
          active = true;
          expiresAt = pickExpiresAt(status.parsed);
          planName = pickPlanName(status.parsed);
          pathUsed = 'recover→status';
        }
      }
    } else if (pickActive(recover.parsed)) {
      active = true;
      expiresAt = pickExpiresAt(recover.parsed);
      planName = pickPlanName(recover.parsed);
      pathUsed = 'recover';
    }
  }

  return {
    label,
    base,
    deviceId,
    active,
    expiresAt,
    planName,
    pathUsed,
    verifyStatus: verify.status,
    verifyMs: verify.ms,
  };
}

async function auditPaymentSurface(base, label) {
  const plans = await fetchJson(base, '/api/plans');
  const checkout = await fetchJson(base, '/api/payments/checkout-providers');
  const providers = await fetchJson(base, '/api/payment-providers');

  const planList = Array.isArray(plans.parsed)
    ? plans.parsed
    : Array.isArray(plans.parsed?.plans)
      ? plans.parsed.plans
      : [];

  if (!plans.ok || planList.length === 0) {
    fail(`${label} plans HTTP ${plans.status}`);
  } else {
    pass(`${label} plans (${planList.length}) HTTP ${plans.status} in ${plans.ms}ms`);
  }

  if (!checkout.ok) {
    fail(`${label} checkout-providers HTTP ${checkout.status}`);
  } else {
    pass(
      `${label} checkout-providers HTTP ${checkout.status} provider=${checkout.parsed?.payment_provider ?? '?'}`,
    );
  }

  if (!providers.ok) {
    fail(`${label} payment-providers HTTP ${providers.status}`);
  } else {
    const count = Array.isArray(providers.parsed)
      ? providers.parsed.length
      : providers.parsed?.providers?.length ?? 0;
    pass(`${label} payment-providers HTTP ${providers.status} (${count})`);
  }

  let createOrderProbe = null;
  const phone = process.env.PAYMENT_TEST_PHONE;
  if (phone && planList[0]) {
    const plan = planList[0];
    const amount = Number(plan.price ?? plan.amount ?? 0);
    const create = await fetchJson(base, '/api/payments/sonicpesa/create-order', {
      method: 'POST',
      body: {
        phone,
        plan_id: plan.id ?? plan.plan_id,
        amount,
        device_id: DEVICE_IDS[0],
      },
    });
    createOrderProbe = {
      status: create.status,
      ms: create.ms,
      orderId: create.parsed?.order_id ?? create.parsed?.orderId ?? null,
      error: create.parsed?.error ?? null,
    };
    if (create.ok && createOrderProbe.orderId) {
      pass(`${label} create-order probe order_id=${createOrderProbe.orderId}`);
    } else {
      console.log(`INFO: ${label} create-order probe HTTP ${create.status}`, createOrderProbe);
    }
  }

  return { planList, createOrderProbe };
}

async function checkOtaManifest() {
  try {
    const appConfig = fs.readFileSync(path.join(__dirname, '..', 'app.config.js'), 'utf8');
    const projectMatch = appConfig.match(/EAS_PROJECT_ID\s*=\s*'([a-f0-9-]+)'/i);
    const projectId = projectMatch?.[1] ?? 'adf835d4-ad5d-425d-9e5b-de9a803066e0';
    const url = `https://u.expo.dev/${projectId}`;
    const manifestUrl = `${url}/manifest?runtimeVersion=${encodeURIComponent(RUNTIME)}&platform=android`;
    const res = await fetch(manifestUrl, {
      headers: { Accept: 'application/expo+json,application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const hasCommit = text.includes(OTA_COMMIT) || text.includes('legacy payment');
    if (res.ok) {
      pass(`OTA manifest reachable HTTP ${res.status} (runtime ${RUNTIME})`);
    } else {
      console.log(`INFO: OTA manifest HTTP ${res.status} — use EAS dashboard for update ${OTA_COMMIT}`);
    }
    return { manifestUrl, status: res.status, hasCommitHint: hasCommit, projectId };
  } catch (e) {
    console.log('INFO: OTA manifest probe skipped', e?.message ?? e);
    return null;
  }
}

(async () => {
  console.log('[verify-production-final-live] starting\n');
  const report = {
    timestamp: new Date().toISOString(),
    package: PACKAGE,
    runtime: RUNTIME,
    otaCommit: OTA_COMMIT,
    hosts: { render: RENDER, contabo: CONTABO },
    payment: {},
    subscriptions: [],
    ota: null,
  };

  report.payment.render = await auditPaymentSurface(RENDER, 'LEGACY_RENDER');
  report.payment.contabo = await auditPaymentSurface(CONTABO, 'VPS_CONTABO');

  for (const deviceId of DEVICE_IDS) {
    const fp = fingerprintFor(deviceId);
    const render = await simulateClientRecoveryChain(RENDER, deviceId, fp, 'LEGACY_RENDER');
    const contabo = await simulateClientRecoveryChain(CONTABO, deviceId, fp, 'VPS_CONTABO');

    const row = { deviceId, fingerprint: fp.slice(0, 16) + '…', render, contabo };
    report.subscriptions.push(row);

    console.log(`\n--- device_id=${deviceId} ---`);
    console.log(JSON.stringify(row, null, 2));

    if (render.active) {
      pass(
        `LEGACY_RENDER subscription active via ${render.pathUsed} exp=${render.expiresAt} plan=${render.planName ?? '?'}`,
      );
    } else {
      fail(`LEGACY_RENDER subscription inactive for ${deviceId}`);
    }

    if (contabo.active) {
      pass(
        `VPS_CONTABO subscription active via ${contabo.pathUsed} exp=${contabo.expiresAt} plan=${contabo.planName ?? '?'}`,
      );
    } else {
      fail(`VPS_CONTABO subscription inactive for ${deviceId}`);
    }

    if (render.active && contabo.active) {
      pass(`Render/Contabo parity: both hosts active for ${deviceId}`);
    }
  }

  report.ota = await checkOtaManifest();

  const outPath = path.join(__dirname, '..', 'dist', 'verify-production-final-live.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (!process.exitCode) {
    console.log('\n[verify-production-final-live] ok');
  } else {
    process.exit(1);
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
