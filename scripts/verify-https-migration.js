#!/usr/bin/env node
'use strict';

/**
 * HTTPS migration audit — no cleartext / raw IP in production app paths.
 * Run: node scripts/verify-https-migration.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const RENDER = 'https://osmani-admin-api.onrender.com';
const VPS = 'https://api.osmanitv.com';

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

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'dist-check', 'dist-crash-test', 'android', 'ios'].includes(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx|ts|tsx|json)$/.test(name)) acc.push(full);
  }
  return acc;
}

const PRODUCTION_PATHS = [
  'lib/apiBaseUrl.js',
  'lib/catalogApiFetch.js',
  'lib/mediaDelivery.js',
  'lib/realtimeSync.js',
  'lib/updateClient.js',
  'app.config.js',
  'eas.json',
  'api.js',
];

const FORBIDDEN_IN_PROD = [
  /http:\/\/144\.91\.117\.90/,
  /usesCleartextTraffic\s*:\s*true/,
  /cleartextTrafficPermitted\s*=\s*["']true["']/,
  /withAndroidCleartextContabo/,
  /NSExceptionAllowsInsecureHTTPLoads/,
];

console.log('[verify-https-migration] production path audit\n');

for (const rel of PRODUCTION_PATHS) {
  const src = read(rel);
  for (const re of FORBIDDEN_IN_PROD) {
    if (rel === 'lib/apiBaseUrl.js' && re.source.includes('144')) continue;
    if (re.test(src)) {
      fail(`${rel} contains forbidden pattern: ${re}`);
    }
  }
}
if (!process.exitCode) pass('production config files have no cleartext / Contabo HTTP');

const apiBase = read('lib/apiBaseUrl.js');
if (!apiBase.includes("DEFAULT_API_URL = RENDER_PRODUCTION_API_URL")) {
  fail('DEFAULT_API_URL must default to Render HTTPS');
} else pass('DEFAULT_API_URL → Render HTTPS (legacy users safe)');

if (!apiBase.includes('https://api.osmanitv.com')) fail('VPS HTTPS domain constant missing');
else pass('VPS HTTPS domain constant present');

const eas = JSON.parse(read('eas.json'));
if (eas.build.production?.env?.EXPO_PUBLIC_API_URL !== RENDER) {
  fail('production EAS profile must embed Render HTTPS');
} else pass('production EAS → Render HTTPS (unchanged for Render users)');

if (eas.build['vps-preview']?.env?.EXPO_PUBLIC_API_URL !== VPS) {
  fail('vps-preview EAS profile must embed api.osmanitv.com');
} else pass('vps-preview EAS → https://api.osmanitv.com');

if (eas.build['vps-preview']?.android?.buildType !== 'apk') {
  fail('vps-preview must build APK only');
} else pass('vps-preview builds APK');

const appConfig = require(path.join(root, 'app.config.js'));
if (Number(appConfig.expo.android?.versionCode) < 22) {
  fail(`versionCode must be >= 22, got ${appConfig.expo.android?.versionCode}`);
} else pass(`versionCode ${appConfig.expo.android.versionCode}`);

if (!String(appConfig.expo.version).startsWith('1.8')) {
  fail(`app version should be 1.8.x for VPS test, got ${appConfig.expo.version}`);
} else pass(`app version ${appConfig.expo.version}`);

// Scan app runtime sources (exclude scripts/backend/dev tools)
const runtimeFiles = walk(root).filter((f) => {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  if (rel.startsWith('scripts/')) return false;
  if (rel.startsWith('backend/')) return false;
  if (rel.startsWith('plugins/withAndroidCleartextContabo')) return false;
  return /\.(js|jsx)$/.test(rel);
});

let ipHits = 0;
const legacyRewriteAllowlist = new Set([
  'lib/apiBaseUrl.js',
  'lib/mediaDelivery.js',
]);
for (const file of runtimeFiles) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  if (/144\.91\.117\.90/.test(src) && !legacyRewriteAllowlist.has(rel)) {
    fail(`runtime source still references raw IP: ${rel}`);
    ipHits += 1;
  }
  if (/http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2|schemas\.android)/.test(src) && !legacyRewriteAllowlist.has(rel)) {
    if (!/primary\.startsWith\('http:\/\/'\)/.test(src)) {
      fail(`runtime source has non-local HTTP URL: ${rel}`);
    }
  }
}
if (ipHits === 0 && !process.exitCode) pass('no raw IP in app runtime sources');

(async () => {
  console.log('\n[live API probes]');
  for (const [label, base] of [
    ['Render (legacy production)', RENDER],
    ['VPS domain (test target)', VPS],
  ]) {
    try {
      const res = await fetch(`${base}/api/health`);
      const body = await res.text();
      if (res.ok) pass(`${label} ${base} → HTTP ${res.status}`);
      else fail(`${label} ${base} → HTTP ${res.status}`);
      console.log(`  ${body.slice(0, 100)}`);
    } catch (e) {
      console.log(`  WARN: ${label} unreachable from this runner (${e?.message ?? e})`);
      if (label.includes('Render')) fail(`${label} must be reachable for legacy users`);
      else console.log('  NOTE: Ensure api.osmanitv.com DNS/TLS points to VPS before device testing.');
    }
  }

  console.log('\n=== ROOT CAUSE (Play rejection) ===');
  console.log('Prior builds embedded http://144.91.117.90:10001 + Android cleartext exceptions.');
  console.log('Data Safety requires all production API traffic over HTTPS with no cleartext config.');
  console.log('Fix: HTTPS-only embeds, remove cleartext plugin, separate vps-preview test profile.');

  if (!process.exitCode) {
    console.log('\n[verify-https-migration] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
