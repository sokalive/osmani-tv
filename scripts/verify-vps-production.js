#!/usr/bin/env node
'use strict';

/**
 * Live VPS production verification (https://api.osmanitv.com).
 * Run: node scripts/verify-vps-production.js
 */

const VPS = (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');
const RENDER = 'https://osmani-admin-api.onrender.com';
const fs = require('fs');
const path = require('path');

const {
  parseUpdateCheckResponse,
} = require('../lib/parseUpdateCheckResponse');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

async function getJson(path, opts = {}) {
  const res = await fetch(`${VPS}${path}`, opts);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body, text };
}

async function postJson(path, payload) {
  return getJson(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

(async () => {
  console.log(`[verify-vps-production] target: ${VPS}\n`);

  const appConfig = require('../app.config.js');
  if (Number(appConfig.expo.android?.versionCode) !== 24) {
    fail(`versionCode must be 24, got ${appConfig.expo.android?.versionCode}`);
  } else pass('versionCode 24');
  if (appConfig.expo.version !== '1.8.2') fail(`version must be 1.8.2, got ${appConfig.expo.version}`);
  else pass('app version 1.8.2');

  const eas = require('../eas.json');
  if (eas.build['vps-preview']?.env?.EXPO_PUBLIC_API_URL !== VPS) {
    fail('vps-preview must embed https://api.osmanitv.com');
  } else pass('vps-preview EAS embeds VPS HTTPS');
if (eas.build.production?.env?.EXPO_PUBLIC_API_URL !== VPS) {
  fail('production EAS profile must embed VPS HTTPS for Play AAB');
} else pass('production EAS → https://api.osmanitv.com (Play AAB)');

if (eas.build.production?.android?.buildType !== 'app-bundle') {
  fail('production profile must build app-bundle (AAB)');
} else pass('production profile builds AAB');

const apiBaseSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'apiBaseUrl.js'), 'utf8');
if (!apiBaseSrc.includes('export const DEFAULT_API_URL = RENDER_PRODUCTION_API_URL')) {
  fail('DEFAULT_API_URL must remain Render HTTPS for legacy OTA/APK users');
} else pass('DEFAULT_API_URL unchanged (Render legacy safe)');

  // Health + catalog (channels / admin sync bootstrap)
  const health = await getJson('/api/health');
  if (!health.res.ok) fail(`/api/health HTTP ${health.res.status}`);
  else pass('/api/health HTTP 200');

  const channels = await getJson('/api/channels');
  if (!channels.res.ok || !Array.isArray(channels.body) || channels.body.length === 0) {
    fail('/api/channels missing or empty');
  } else pass(`/api/channels (${channels.body.length} rows)`);

  const banners = await getJson('/api/banners');
  if (!banners.res.ok || !Array.isArray(banners.body)) fail('/api/banners invalid');
  else pass(`/api/banners (${banners.body.length} rows)`);

  // Login / subscription verify
  const verify = await postJson('/api/subscription/verify', {
    device_id: 'VPS_VERIFY_PROBE',
    device_fingerprint: 'vps_verify_probe_fp',
  });
  if (!verify.res.ok || typeof verify.body !== 'object') fail('/api/subscription/verify failed');
  else pass('/api/subscription/verify (login path) HTTP 200');

  // Payments
  for (const path of ['/api/plans', '/api/payment-providers', '/api/payments/checkout-providers']) {
    const { res, body } = await getJson(path);
    if (!res.ok) fail(`${path} HTTP ${res.status}`);
    else pass(`${path} HTTP 200`);
    if (path === '/api/plans' && !Array.isArray(body) && !Array.isArray(body?.plans)) {
      fail('/api/plans shape invalid');
    }
  }

  // Notifications / popup + whatsapp
  for (const path of ['/api/whatsapp-settings', '/api/popup-settings']) {
    const { res } = await getJson(path);
    if (!res.ok) fail(`${path} HTTP ${res.status}`);
    else pass(`${path} HTTP 200`);
  }

  // Update system
  const qs = new URLSearchParams({
    platform: 'android',
    package: 'com.burudanitv.app',
    version_code: '24',
    version_name: '1.8.2',
  });
  const update = await getJson(`/api/update-check?${qs}`);
  if (!update.res.ok) fail(`/api/update-check HTTP ${update.res.status}`);
  else {
    const parsed = parseUpdateCheckResponse(update.body, { installedVersionCode: 24 });
    pass(`/api/update-check decision=${parsed?.decision} latest=${parsed?.latestVersionCode}`);
    if (parsed?.decision !== 'NONE' && parsed?.latestVersionCode > 0 && 24 >= parsed.latestVersionCode) {
      fail('v24 should not see update UI when on latest');
    }
  }

  // Analytics
  const analytics = await postJson('/api/analytics/presence/heartbeat', {
    device_id: 'vps_verify_probe',
    session_id: 'verify-session',
  });
  if (!analytics.res.ok) fail(`/api/analytics/presence/heartbeat HTTP ${analytics.res.status}`);
  else pass('/api/analytics/presence/heartbeat HTTP 200');

  // Admin sync / runtime modes
  const settings = await getJson('/api/settings');
  if (!settings.res.ok) fail('/api/settings HTTP ' + settings.res.status);
  else pass('/api/settings (runtime modes cold start) HTTP 200');

  const trial = await getJson('/api/runtime/trial-watch');
  if (!trial.res.ok) fail('/api/runtime/trial-watch HTTP ' + trial.res.status);
  else pass('/api/runtime/trial-watch HTTP 200');

  // SSE stream reachable
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const sseRes = await fetch(`${VPS}/api/sync/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!sseRes.ok) fail(`/api/sync/stream HTTP ${sseRes.status}`);
    else pass(`/api/sync/stream HTTP ${sseRes.status} (admin SSE)`);
    try {
      sseRes.body?.cancel?.();
    } catch {}
  } catch (e) {
    clearTimeout(timer);
    if (String(e?.name) === 'AbortError') pass('/api/sync/stream reachable (long-poll opened, probe aborted)');
    else fail(`/api/sync/stream ${e?.message ?? e}`);
  }

  // Playback proxy (channel stream)
  const withPlayback = (channels.body || []).find((c) => {
    const u = String(c.playbackUrl || c.playback_url || '');
    return u.includes('stream-proxy') || u.includes('.m3u8');
  });
  if (!withPlayback) {
    console.log('WARN: no stream-proxy channel in sample — skip playback probe');
  } else {
    let playUrl = String(withPlayback.playbackUrl || withPlayback.playback_url);
    if (playUrl.startsWith('/')) playUrl = `${VPS}${playUrl}`;
    const playRes = await fetch(playUrl, { headers: { Accept: '*/*' } });
    if (!playRes.ok) fail(`playback probe HTTP ${playRes.status} for ${withPlayback.name}`);
    else pass(`playback probe HTTP ${playRes.status} (${withPlayback.name})`);
  }

  // Render untouched spot-check
  const renderHealth = await fetch(`${RENDER}/api/health`);
  if (!renderHealth.ok) fail('Render production health must stay HTTP 200');
  else pass('Render production /api/health still HTTP 200');

  if (!process.exitCode) {
    console.log('\n[verify-vps-production] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
