#!/usr/bin/env node
'use strict';

/**
 * Verify production mobile app targets Contabo Admin API (not Render).
 * Run: node scripts/verify-contabo-api.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CONTABO = 'http://144.91.117.90:10001';
const RENDER = 'osmani-admin-api.onrender.com';

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

const apiBase = read('lib/apiBaseUrl.js');
if (!apiBase.includes(CONTABO)) fail('lib/apiBaseUrl.js must default to Contabo');
else pass('lib/apiBaseUrl.js defaults to Contabo');

const apiJs = read('api.js');
if (apiJs.includes(RENDER)) fail('api.js must not reference Render host');
else pass('api.js has no Render host');

const eas = read('eas.json');
const appConfig = read('app.config.js');
if (!eas.includes(`"EXPO_PUBLIC_API_URL": "${CONTABO}"`)) {
  fail('eas.json production must set EXPO_PUBLIC_API_URL to Contabo');
} else pass('eas.json sets EXPO_PUBLIC_API_URL');

const RENDER_ALLOWLIST = new Set([
  'lib/apiBaseUrl.js',
  'lib/catalogApiFetch.js',
]);

const offenders = [];
for (const dir of PRODUCTION_DIRS) {
  const files = dir.endsWith('.js') ? [dir] : walkFiles(dir);
  for (const rel of files) {
    if (rel === 'lib/apiBaseUrl.js' || rel === 'lib/mediaDelivery.js') continue;
    if (RENDER_ALLOWLIST.has(rel)) continue;
    const text = read(rel);
    if (text.includes(RENDER)) offenders.push(rel);
  }
}
if (offenders.length) {
  fail(`production paths still reference Render: ${offenders.join(', ')}`);
} else {
  pass('no Render host in production app paths (except legacy HTTPS fallback helpers)');
}

(async () => {
  const checks = [
    ['/api/channels', (b) => Array.isArray(b) && b.length > 0],
    ['/api/banners', (b) => Array.isArray(b)],
    [
      '/api/update-check?platform=android&package=com.burudanitv.app&version_code=19&version_name=1.7.2',
      (b) => b && typeof b === 'object' && b.decision != null,
    ],
    ['/api/users-intelligence/register', null, 'POST', { device_id: 'verify-contabo', last_seen: new Date().toISOString() }],
  ];

  for (const [pathSuffix, validate, method = 'GET', body] of checks) {
    const url = `${CONTABO}${pathSuffix}`;
    const opts = {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      fail(`${pathSuffix} HTTP ${res.status}`);
      continue;
    }
    if (validate && !validate(parsed)) {
      fail(`${pathSuffix} invalid body`);
    } else {
      pass(`Contabo ${method} ${pathSuffix} → ${res.status}`);
    }
  }

  const sseRes = await fetch(`${CONTABO}/api/sync/stream`, {
    headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(5000),
  }).catch((e) => ({ ok: false, status: e?.name }));
  if (sseRes.ok) pass('Contabo GET /api/sync/stream reachable');
  else fail('Contabo SSE /api/sync/stream unreachable');

  const media = read('lib/mediaDelivery.js');
  if (!media.includes('resolveApiBaseUrl()}/stream-proxy')) {
    fail('stream-proxy default must use Contabo API base');
  } else {
    pass('stream-proxy defaults to Contabo API base');
  }

  if (!fs.existsSync(path.join(root, 'plugins', 'withAndroidCleartextContabo.js'))) {
    fail('missing withAndroidCleartextContabo plugin');
  } else {
    pass('Android cleartext Contabo plugin present');
  }

  if (!appConfig.includes('withAndroidCleartextContabo')) {
    fail('app.config must register withAndroidCleartextContabo plugin');
  } else {
    pass('app.config registers cleartext plugin');
  }

  if (!fs.existsSync(path.join(root, 'lib', 'catalogApiFetch.js'))) {
    fail('missing catalogApiFetch');
  } else {
    pass('catalog API fetch helper present');
  }

  const catalogFetch = read('lib/catalogApiFetch.js');
  if (!catalogFetch.includes('legacy-https-fallback') || !catalogFetch.includes('LEGACY_HTTPS_API_FALLBACK')) {
    fail('catalog fetch must offer Render HTTPS transport fallback when Contabo HTTP primary');
  } else {
    pass('catalog fetch has Render HTTPS transport fallback for Contabo HTTP primary');
  }

  const payment = read('api/payment.js');
  if (!payment.includes('fetchAdminApiJson') || !payment.includes('fetchAdminApiResponse')) {
    fail('payment API must use shared admin fetch with transport fallback');
  } else {
    pass('payment API uses shared admin fetch helper');
  }

  if (!read('lib/mediaDelivery.js').includes('isAdminUploadPath')) {
    fail('mediaDelivery must rewrite Contabo /uploads to CDN');
  } else {
    pass('Contabo upload thumbnails rewrite to CDN');
  }

  if (!process.exitCode) {
    console.log('\n[verify-contabo-api] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
