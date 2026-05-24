#!/usr/bin/env node
'use strict';

/**
 * Verifies update-check normalization + strict latest_version_code gating.
 *
 * Usage:
 *   node scripts/verify-update-check.js
 *   node scripts/verify-update-check.js --installed=16
 */

const {
  applyVersionGate,
  isOutdated,
  parseUpdateCheckResponse,
} = require('../lib/parseUpdateCheckResponse');

const BASE =
  (process.env.EXPO_PUBLIC_API_URL || 'https://osmani-admin-api.onrender.com').replace(/\/+$/, '');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

function assert(label, cond) {
  if (!cond) {
    console.error('FAIL:', label);
    process.exitCode = 1;
    return false;
  }
  console.log('PASS:', label);
  return true;
}

function unitTests() {
  const latest = 16;
  const basePayload = {
    decision: 'FORCE',
    source: 'apk',
    latest_version_code: latest,
    latest_version_name: '1.6.0',
    force_update: true,
    soft_update: true,
    apk_url: 'https://osmanitv.b-cdn.net/builds/test.apk',
  };

  const v14 = parseUpdateCheckResponse(basePayload, { installedVersionCode: 14 });
  assert('v14 outdated → FORCE', v14?.decision === 'FORCE');

  const v15 = parseUpdateCheckResponse(basePayload, { installedVersionCode: 15 });
  assert('v15 outdated → FORCE', v15?.decision === 'FORCE');

  const v16 = parseUpdateCheckResponse(basePayload, { installedVersionCode: 16 });
  assert('v16 on latest → NONE (admin FORCE ignored)', v16?.decision === 'NONE');

  const v16Soft = parseUpdateCheckResponse(
    { ...basePayload, decision: 'SOFT', force_update: false },
    { installedVersionCode: 16 },
  );
  assert('v16 on latest → NONE (admin SOFT ignored)', v16Soft?.decision === 'NONE');

  assert('isOutdated(14,16)', isOutdated(14, 16) === true);
  assert('isOutdated(16,16)', isOutdated(16, 16) === false);
  assert('isOutdated(17,16)', isOutdated(17, 16) === false);

  const gated = applyVersionGate({
    decision: 'FORCE',
    installedVersionCode: 16,
    latestVersionCode: 16,
  });
  assert('applyVersionGate suppresses FORCE on latest', gated.decision === 'NONE');

  // Production-shaped body (version_code as latest alias)
  const prodShape = parseUpdateCheckResponse(
    {
      decision: 'NONE',
      source: 'apk',
      version_code: 16,
      version_name: '1.6.0',
      soft_update: true,
    },
    { installedVersionCode: 14 },
  );
  assert('prod shape v14 → SOFT', prodShape?.decision === 'SOFT');
  assert('prod shape latest parsed as 16', prodShape?.latestVersionCode === 16);

  const prodV16 = parseUpdateCheckResponse(
    {
      decision: 'NONE',
      source: 'apk',
      version_code: 16,
      force_update: true,
    },
    { installedVersionCode: 16 },
  );
  assert('prod shape v16 → NONE', prodV16?.decision === 'NONE');
}

async function fetchUpdateCheck(installed, pkg) {
  const qs = new URLSearchParams({
    platform: 'android',
    package: pkg,
    version_code: String(installed),
    version_name: '1.6.0',
  });
  const url = `${BASE}/api/update-check?${qs.toString()}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { url, status: res.status, body };
}

async function main() {
  console.log('[verify-update-check] strict latest_version_code gate\n');
  unitTests();

  const installed = Number(arg('installed', '14'));
  console.log('\n[live API] installed:', installed, 'base:', BASE);
  for (const pkg of ['com.burudanitv.app']) {
    const { status, body } = await fetchUpdateCheck(installed, pkg);
    if (!body) continue;
    const out = parseUpdateCheckResponse(body, { installedVersionCode: installed });
    console.log(`  ${pkg} HTTP ${status} → decision=${out?.decision} latest=${out?.latestVersionCode}`);
  }
}

main().catch((e) => {
  console.error('[verify-update-check] fatal:', e?.message ?? e);
  process.exitCode = 1;
});
