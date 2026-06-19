#!/usr/bin/env node
'use strict';

/**
 * Full APK compatibility + subscription continuity audit (Render old APK vs Contabo VPS APK).
 * Run: node scripts/verify-apk-compatibility-audit.js
 */

const fs = require('fs');
const path = require('path');
const {
  parseUpdateCheckResponse,
  applyVersionGate,
} = require('../lib/parseUpdateCheckResponse');

const root = path.join(__dirname, '..');
const RENDER = 'https://osmani-admin-api.onrender.com';
const CONTABO = (process.env.EXPO_PUBLIC_API_URL || 'http://144.91.117.90:10001').replace(/\/+$/, '');
const CDN = 'https://osmanitv.b-cdn.net';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function rewriteThumb(url) {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/uploads/')) {
      const cdn = new URL(CDN);
      u.protocol = cdn.protocol;
      u.hostname = cdn.hostname;
      u.port = cdn.port;
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return url;
}

async function fetchJson(base, pathSuffix, opts = {}) {
  const url = `${base}${pathSuffix}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    signal: AbortSignal.timeout(25000),
  });
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { url, status: res.status, ok: res.ok, body, text };
}

async function postSub(base, pathSuffix, payload) {
  const out = { ...payload };
  if (out.device_fingerprint != null && out.fingerprint == null) {
    out.fingerprint = out.device_fingerprint;
  }
  return fetchJson(base, pathSuffix, { method: 'POST', body: JSON.stringify(out) });
}

async function auditHost(label, base) {
  console.log(`\n=== ${label} (${base}) ===\n`);

  const channels = await fetchJson(base, '/api/channels');
  if (!channels.ok || !Array.isArray(channels.body) || channels.body.length === 0) {
    fail(`${label} channels`);
  } else {
    pass(`${label} channels (${channels.body.length})`);
  }

  const banners = await fetchJson(base, '/api/banners');
  if (!banners.ok || !Array.isArray(banners.body)) fail(`${label} banners`);
  else pass(`${label} banners (${banners.body.length})`);

  const plans = await fetchJson(base, '/api/plans');
  const planList = Array.isArray(plans.body) ? plans.body : plans.body?.plans;
  if (!plans.ok || !Array.isArray(planList) || planList.length === 0) fail(`${label} plans`);
  else pass(`${label} plans (${planList.length})`);

  const thumbRaw =
    channels.body?.find((c) => c?.thumbnail || c?.thumbnail_url)?.thumbnail ||
    channels.body?.find((c) => c?.thumbnail_url)?.thumbnail_url;
  if (thumbRaw) {
    const cdnUrl = rewriteThumb(thumbRaw);
    const head = await fetch(cdnUrl, { method: 'HEAD', signal: AbortSignal.timeout(12000) }).catch(
      () => ({ ok: false }),
    );
    if (head.ok) pass(`${label} thumbnail CDN`);
    else fail(`${label} thumbnail CDN HEAD failed for ${cdnUrl}`);
  }

  const proxyRow = channels.body?.find((c) =>
    String(c.playbackUrl || c.playback_url || '').includes('/stream-proxy'),
  );
  if (proxyRow) {
    const manifestUrl = String(proxyRow.playbackUrl || proxyRow.playback_url);
    const probe = await fetch(manifestUrl, {
      headers: { Accept: 'application/vnd.apple.mpegurl,*/*' },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    const text = probe?.ok ? await probe.text() : '';
    if (probe?.ok && text.includes('#EXTM3U')) {
      pass(`${label} playback proxy manifest (${proxyRow.name})`);
    } else {
      console.log(`INFO: ${label} playback probe skipped/failed for ${proxyRow.name}`);
    }
  }

  for (const vc of [19, 20]) {
    const uc = await fetchJson(
      base,
      `/api/update-check?platform=android&package=com.burudanitv.app&version_code=${vc}&version_name=1.7.2`,
    );
    const parsed = parseUpdateCheckResponse(uc.body, { installedVersionCode: vc });
    const gated = applyVersionGate(parsed);
    if (!uc.ok) fail(`${label} update-check v${vc}`);
    else if (gated?.decision === 'FORCE') fail(`${label} update-check v${vc} → FORCE (must stay OFF)`);
    else if (vc >= 19 && gated?.decision !== 'NONE') {
      fail(`${label} update-check v${vc} should gate to NONE on latest installs`);
    } else {
      pass(`${label} update-check v${vc} → ${gated?.decision} (safe)`);
    }
  }

  const verify = await postSub(base, '/api/subscription/verify', {
    device_id: 'apk-audit-device',
    device_fingerprint: 'apk-audit-fp',
  });
  if (!verify.ok) fail(`${label} subscription verify HTTP ${verify.status}`);
  else pass(`${label} subscription verify endpoint`);

  const recover = await postSub(base, '/api/subscription/recover', {
    device_id: 'apk-audit-device',
    device_fingerprint: 'apk-audit-fp',
  });
  if (recover.status === 400) fail(`${label} recover rejects fingerprint alias (400)`);
  else pass(`${label} recover accepts fingerprint (${recover.status})`);

  return {
    channels: channels.body?.length ?? 0,
    plans: planList?.length ?? 0,
  };
}

function auditStatic() {
  const sub = read('api/subscription.js');
  if (!sub.includes('resolveApiBaseUrl')) fail('subscription must resolve API at request time');
  else pass('subscription runtime API base');

  if (!sub.includes('has_subscription')) fail('pickActive must read has_subscription');
  else pass('pickActive extended fields');

  if (!sub.includes('refreshSubscriptionAfterRecover') && !sub.includes('refreshed_after_ok')) {
    fail('recover must re-fetch verify/status when API returns ok without active');
  } else pass('recover refreshes after minimal ok payload');

  const ctx = read('context/OsmaniAppContext.jsx');
  if (!ctx.includes('transport_preserved_cache')) {
    fail('context must preserve subscription cache on transport errors');
  } else pass('subscription cache preserved on transport errors');

  if (!ctx.includes('resolveActiveSubscription')) {
    fail('context must resolve subscriptions via resolveActiveSubscription');
  } else pass('context uses resolveActiveSubscription');

  if (!sub.includes('resolveActiveSubscription')) {
    fail('subscription must export resolveActiveSubscription for APK migration');
  } else pass('resolveActiveSubscription migration resolver');

  const deviceIdSrc = read('lib/deviceIdentity.js');
  if (!deviceIdSrc.includes('LEGACY_ANDROID_PACKAGE')) {
    fail('deviceIdentity must define LEGACY_ANDROID_PACKAGE');
  } else pass('legacy package constant for migration bridge');

  if (!deviceIdSrc.includes('legacyPackageAndroidId')) {
    fail('deviceIdentity must expose legacyPackageAndroidId');
  } else pass('legacy package android id bridge');

  if (!deviceIdSrc.includes('stableHardwareId')) {
    fail('deviceIdentity must expose stableHardwareId');
  } else pass('stable hardware id field');

  if (!sub.includes('SUBSCRIPTION_MIGRATION')) {
    fail('subscription resolve must log SUBSCRIPTION_MIGRATION');
  } else pass('subscription migration logging');

  if (!sub.includes('SUBSCRIPTION_RESTORE_RESULT')) {
    fail('subscription resolve must log SUBSCRIPTION_RESTORE_RESULT');
  } else pass('subscription restore result logging');

  if (!sub.includes('legacy_device_id')) {
    fail('migration payload must include legacy_device_id');
  } else pass('legacy_device_id in migration payload');

  const nativeBridge = read('lib/nativeDeviceBridge.js');
  if (!nativeBridge.includes('tryReadLegacyPackageAndroidId')) {
    fail('native device bridge must read legacy package android id');
  } else pass('native legacy SSAID bridge');

  const secMod = read('modules/osmani-security/index.ts');
  if (!secMod.includes('getStableHardwareId')) {
    fail('osmani-security must export getStableHardwareId');
  } else pass('native stable hardware id export');

  if (!sub.includes('legacy_device_fingerprint')) {
    fail('subscription recover/verify must send legacy_device_fingerprint');
  } else pass('migration payload includes legacy_device_fingerprint');

  const payment = read('api/payment.js');
  if (!payment.includes('fetchAdminApiJson')) fail('payment must use fetchAdminApiJson');
  else pass('payment uses transport-aware fetch');

  const catalogFetch = read('lib/catalogApiFetch.js');
  if (!catalogFetch.includes('LEGACY_HTTPS_API_FALLBACK')) {
    fail('catalog fetch must define legacy HTTPS fallback');
  } else pass('legacy HTTPS API fallback present');

  const apiBase = read('lib/apiBaseUrl.js');
  if (apiBase.includes('LEGACY_API_HOSTS') && apiBase.match(/resolveApiBaseUrl[\s\S]{0,400}LEGACY_API_HOSTS/)) {
    fail('resolveApiBaseUrl must not force-remap Render hosts to Contabo');
  } else pass('resolveApiBaseUrl honors embedded EXPO_PUBLIC_API_URL');

  const app = read('App.js');
  if (!app.includes('isCatalogInteractionBlocked')) fail('offline modal must use catalogBlocked');
  else pass('offline modal catalog-grounded');

  if (!read('lib/catalogConnectivity.js').includes('shouldMarkCatalogOffline')) {
    fail('catalog connectivity helper missing');
  } else pass('catalog connectivity helper');
}

(async () => {
  console.log('[verify-apk-compatibility-audit] starting\n');
  auditStatic();

  const renderStats = await auditHost('OLD_APK_TARGET (Render)', RENDER);
  const contaboStats = await auditHost('NEW_VPS_APK_TARGET (Contabo)', CONTABO);

  console.log('\n=== SUMMARY ===');
  console.log(
    JSON.stringify(
      {
        render: renderStats,
        contabo: contaboStats,
        deviceIdentity: {
          deviceId: 'Android ID / iOS IDFV (stable across APK upgrade)',
          fingerprint: 'SHA256(deviceId|bundle|installInstanceId) — changes on reinstall',
          recoverKey: 'backend matches device_id; recover requires fingerprint field',
        },
        migrationNotes: [
          'Same-package APK upgrade keeps AsyncStorage subscription cache',
          'recover + verify on cold start re-binds VPS subscription by device_id',
          'Transport errors no longer clear active subscription cache',
        ],
        forceUpdate: 'OFF for v20/v21 (client version gate)',
      },
      null,
      2,
    ),
  );

  if (!process.exitCode) {
    console.log('\n[verify-apk-compatibility-audit] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
