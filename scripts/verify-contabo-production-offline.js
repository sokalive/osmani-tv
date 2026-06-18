#!/usr/bin/env node
'use strict';

/**
 * End-to-end Contabo production verification with Render Admin API expected OFF.
 * Run: node scripts/verify-contabo-production-offline.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CONTABO = (process.env.EXPO_PUBLIC_API_URL || 'http://144.91.117.90:10001').replace(/\/+$/, '');
const RENDER = 'https://osmani-admin-api.onrender.com';
const CDN = process.env.EXPO_PUBLIC_MEDIA_CDN_BASE || 'https://osmanitv.b-cdn.net';
const RENDER_HOST = 'osmani-admin-api.onrender.com';

const PRODUCTION_DIRS = ['api', 'api.js', 'context', 'components', 'screens', 'hooks', 'lib', 'modules'];

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

function walkFiles(relPath, out = []) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return out;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (/\.(js|jsx|ts|tsx)$/.test(relPath)) out.push(relPath);
    return out;
  }
  for (const name of fs.readdirSync(abs)) {
    if (name === 'node_modules' || name === 'backend') continue;
    walkFiles(path.join(relPath, name).replace(/\\/g, '/'), out);
  }
  return out;
}

/** Mirror lib/mediaDelivery.js admin upload rewrite for verification. */
function rewriteAdminUploadUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    const isLegacy = host === RENDER_HOST || host === 'osmani-tv.onrender.com';
    const isContaboUpload =
      host === new URL(CONTABO).host.toLowerCase() && u.pathname.startsWith('/uploads/');
    if (!isLegacy && !isContaboUpload) return s;
    const cdn = new URL(CDN);
    u.protocol = cdn.protocol;
    u.hostname = cdn.hostname;
    u.port = cdn.port;
    return u.toString();
  } catch {
    return s;
  }
}

// --- Static: no Render runtime fetch fallback ---
const catalogFetch = read('lib/catalogApiFetch.js');
if (catalogFetch.includes('https-fallback') || catalogFetch.includes('HTTPS_TRANSPORT_FALLBACK')) {
  fail('catalogApiFetch must not use Render HTTPS fallback in production');
} else {
  pass('no Render HTTPS fallback in catalogApiFetch');
}

const excludedRenderLists = new Set([
  'lib/apiBaseUrl.js',
  'lib/mediaDelivery.js',
  'lib/firstLaunchBootDiagnostics.js',
]);
const runtimeRenderOffenders = [];
for (const dir of PRODUCTION_DIRS) {
  const files = dir.endsWith('.js') ? [dir] : walkFiles(dir);
  for (const rel of files) {
    if (excludedRenderLists.has(rel)) continue;
    const text = read(rel);
    if (
      text.includes('osmani-admin-api.onrender.com') &&
      (text.includes('fetch(') || text.includes('EventSource') || text.includes('https://osmani'))
    ) {
      runtimeRenderOffenders.push(rel);
    }
  }
}
if (runtimeRenderOffenders.length) {
  fail(`runtime fetch paths still target Render: ${runtimeRenderOffenders.join(', ')}`);
} else {
  pass('no runtime fetch/EventSource to Render in production app code');
}

if (!read('lib/mediaDelivery.js').includes('isAdminUploadPath')) {
  fail('mediaDelivery must rewrite Contabo /uploads to CDN');
} else {
  pass('Contabo /uploads CDN rewrite present');
}

(async () => {
  console.log('\n=== Live API (Contabo) ===\n');

  // Render expected OFF — warn only (admin may still be winding down)
  try {
    const renderRes = await fetch(`${RENDER}/api/channels`, {
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (renderRes?.ok) {
      console.warn('WARN: Render still responds — app must not call it (Contabo-only enforced in JS)');
    } else {
      pass('Render Admin API unreachable or non-OK (expected when OFF)');
    }
  } catch {
    pass('Render Admin API unreachable (expected when OFF)');
  }

  const channelsRes = await fetch(`${CONTABO}/api/channels`, {
    signal: AbortSignal.timeout(25000),
  });
  const channels = await channelsRes.json().catch(() => null);
  if (!channelsRes.ok || !Array.isArray(channels) || channels.length === 0) {
    fail(`channels: HTTP ${channelsRes.status}`);
  } else {
    pass(`channels load (${channels.length})`);
  }

  const thumbRaw =
    channels.find((c) => c?.thumbnail || c?.thumbnail_url)?.thumbnail ||
    channels.find((c) => c?.thumbnail_url)?.thumbnail_url;
  if (!thumbRaw) {
    fail('no channel thumbnail in catalog');
  } else {
    const thumbCdn = rewriteAdminUploadUrl(thumbRaw);
    const head = await fetch(thumbCdn, { method: 'HEAD', signal: AbortSignal.timeout(12000) }).catch(
      () => ({ ok: false, status: 0 }),
    );
    if (!head.ok) fail(`thumbnail CDN HEAD ${head.status} for ${thumbCdn}`);
    else pass(`channel thumbnail CDN (${thumbCdn.slice(0, 72)}…)`);
  }

  const plansRes = await fetch(`${CONTABO}/api/plans`);
  const plans = await plansRes.json().catch(() => null);
  const planList = Array.isArray(plans) ? plans : plans?.plans ?? plans?.data;
  if (!plansRes.ok || !Array.isArray(planList) || planList.length === 0) {
    fail(`plans: HTTP ${plansRes.status}`);
  } else {
    pass(`plans load (${planList.length})`);
  }

  const verifyRes = await fetch(`${CONTABO}/api/subscription/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ device_id: 'verify-contabo-offline', device_fingerprint: 'verify' }),
  });
  const verifyBody = await verifyRes.json().catch(() => null);
  if (!verifyRes.ok || !verifyBody || typeof verifyBody !== 'object') {
    fail(`subscription/verify: HTTP ${verifyRes.status}`);
  } else {
    pass('subscription verify endpoint');
  }

  const regRes = await fetch(`${CONTABO}/api/users-intelligence/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      device_id: 'verify-contabo-offline',
      last_seen: new Date().toISOString(),
      app_version: '1.7.2',
    }),
  });
  if (!regRes.ok) fail(`users-intelligence register: HTTP ${regRes.status}`);
  else pass('users intelligence register');

  const updateUrl = `${CONTABO}/api/update-check?platform=android&package=com.burudanitv.app&version_code=20&version_name=1.7.2`;
  const updateRes = await fetch(updateUrl);
  const updateBody = await updateRes.json().catch(() => null);
  if (!updateRes.ok || !updateBody?.decision) {
    fail(`update-check: HTTP ${updateRes.status}`);
  } else {
    pass(`update-check (${updateBody.decision})`);
  }

  const hls = channels.filter(
    (c) =>
      /\/stream-proxy/i.test(String(c.playbackUrl || c.playback_url || '')) ||
      /\.m3u8/i.test(String(c.url || '')),
  );
  const proxySample = hls.find((c) =>
    String(c.playbackUrl || c.playback_url || '').includes(new URL(CONTABO).host),
  );
  if (proxySample) {
    const bein = hls.find(
      (c) =>
        /#EXTM3U|het\d+b\.ycn-redirect/i.test(String(c.playbackUrl || c.playback_url || '')) ||
        (String(c.name || '').toLowerCase().includes('bein') &&
          String(c.playbackUrl || c.playback_url || '').includes(new URL(CONTABO).host)),
    );
    const probeRow = bein || proxySample;
    const manifestUrl = String(probeRow.playbackUrl || probeRow.playback_url);
    const probe = await fetch(manifestUrl, {
      headers: { Accept: 'application/vnd.apple.mpegurl,*/*' },
      signal: AbortSignal.timeout(15000),
    }).catch((e) => ({ ok: false, status: e.message }));
    const text = probe.ok ? await probe.text() : '';
    if (probe.ok && text.includes('#EXTM3U')) {
      pass(`playback stream-proxy manifest (${probeRow.name})`);
    } else {
      fail(`stream-proxy manifest probe failed for ${probeRow.name} (${probe.status})`);
    }
  } else {
    console.warn('WARN: no Contabo stream-proxy channel in sample — skip playback probe');
  }

  const sseRes = await fetch(`${CONTABO}/api/sync/stream`, {
    headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(5000),
  }).catch((e) => ({ ok: false, status: e?.name }));
  if (sseRes.ok) pass('SSE /api/sync/stream reachable');
  else fail('SSE /api/sync/stream unreachable');

  if (!process.exitCode) {
    console.log('\n[verify-contabo-production-offline] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
