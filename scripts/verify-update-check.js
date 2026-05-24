#!/usr/bin/env node
'use strict';

/**
 * Verifies /api/update-check contract + client normalization against production
 * (or EXPO_PUBLIC_API_URL override).
 *
 * Usage:
 *   node scripts/verify-update-check.js
 *   node scripts/verify-update-check.js --installed=14
 */

const { parseUpdateCheckResponse, mergeUpdateInfo } = require('../lib/parseUpdateCheckResponse');

const BASE =
  (process.env.EXPO_PUBLIC_API_URL || 'https://osmani-admin-api.onrender.com').replace(/\/+$/, '');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

async function fetchUpdateCheck(installed, pkg) {
  const qs = new URLSearchParams({
    platform: 'android',
    package: pkg,
    version_code: String(installed),
    version_name: '1.0.0',
  });
  const url = `${BASE}/api/update-check?${qs.toString()}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { url, status: res.status, body };
}

function summarize(label, raw, installed) {
  const normalized = parseUpdateCheckResponse(raw, {
    installedVersionCode: installed,
    requestVersionCode: installed,
  });
  const merged = mergeUpdateInfo(
    { decision: raw?.decision ?? 'NONE', installedVersionCode: installed },
    normalized,
  );
  console.log(`\n[${label}]`);
  console.log('  raw.decision:', raw?.decision);
  console.log('  raw.version_code:', raw?.version_code);
  console.log('  raw.apk_url:', raw?.apk_url ? `${String(raw.apk_url).slice(0, 60)}…` : '(empty)');
  console.log('  normalized.decision:', normalized?.decision);
  console.log('  normalized.latestVersionCode:', normalized?.latestVersionCode);
  console.log('  merged.decision:', merged?.decision);
  console.log('  merged.decisionRecovered:', Boolean(merged?.decisionRecovered));
  return merged;
}

async function main() {
  const installed = Number(arg('installed', '14'));
  const packages = ['com.burudanitv.app', 'com.osmantv.app'];
  console.log('[verify-update-check] base:', BASE);
  console.log('[verify-update-check] installed version_code:', installed);

  for (const pkg of packages) {
    const { url, status, body } = await fetchUpdateCheck(installed, pkg);
    console.log('\n---', pkg, 'HTTP', status);
    console.log('URL:', url);
    if (!body) {
      console.error('  invalid JSON');
      continue;
    }
    summarize(pkg, body, installed);
  }

  // Unit sanity: production-shaped payload with flags but decision NONE
  const mock = {
    decision: 'NONE',
    source: 'apk',
    version_code: 15,
    apk_url: 'https://osmanitv.b-cdn.net/builds/test.apk',
    soft_update: true,
    update_title: 'Update ready',
    update_message: 'Please install the latest version.',
  };
  const mockOut = parseUpdateCheckResponse(mock, { installedVersionCode: 14 });
  console.log('\n[mock outdated soft] decision:', mockOut?.decision, 'target:', mockOut?.latestVersionCode);
  if (mockOut?.decision !== 'SOFT') {
    console.error('FAIL: expected SOFT from mock payload');
    process.exitCode = 1;
  } else {
    console.log('PASS: mock normalization');
  }
}

main().catch((e) => {
  console.error('[verify-update-check] fatal:', e?.message ?? e);
  process.exitCode = 1;
});
