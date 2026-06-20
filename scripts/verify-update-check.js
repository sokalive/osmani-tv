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
  (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');

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

  const v21 = parseUpdateCheckResponse(basePayload, { installedVersionCode: 21 });
  assert('v21 on latest → NONE (admin FORCE ignored)', v21?.decision === 'NONE');

  const v20Soft = parseUpdateCheckResponse(
    { ...basePayload, decision: 'SOFT', force_update: false, latest_version_code: 21 },
    { installedVersionCode: 20 },
  );
  assert('v20 below latest 21 + admin SOFT → SOFT', v20Soft?.decision === 'SOFT');

  const v21Latest = parseUpdateCheckResponse(
    { ...basePayload, decision: 'SOFT', force_update: false, latest_version_code: 21 },
    { installedVersionCode: 21 },
  );
  assert('v21 on latest 21 + admin SOFT → NONE', v21Latest?.decision === 'NONE');

  assert('v20 below v21 outdated', isOutdated(20, 21) === true);
  assert('v21 not outdated vs 21', isOutdated(21, 21) === false);

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

  const adminOffPlay = parseUpdateCheckResponse(
    {
      decision: 'NONE',
      source: 'play',
      soft_update: false,
      force_update: false,
      latest_version_code: 24,
      playstore_url: 'https://play.google.com/store/apps/details?id=com.burudanitv.app',
    },
    { installedVersionCode: 19 },
  );
  assert('admin OFF + play metadata → NONE (no silent popup)', adminOffPlay?.decision === 'NONE');

  const adminOnPlay = parseUpdateCheckResponse(
    {
      decision: 'SOFT',
      source: 'play',
      soft_update: true,
      latest_version_code: 24,
      playstore_url: 'https://play.google.com/store/apps/details?id=com.burudanitv.app',
    },
    { installedVersionCode: 19 },
  );
  assert('admin ON soft v19 → SOFT', adminOnPlay?.decision === 'SOFT');

  const v24Gate = parseUpdateCheckResponse(
    {
      decision: 'SOFT',
      soft_update: true,
      latest_version_code: 24,
      playstore_url: 'https://play.google.com/store/apps/details?id=com.burudanitv.app',
    },
    { installedVersionCode: 24 },
  );
  assert('v24 hard gate → NONE even if admin SOFT', v24Gate?.decision === 'NONE');

  const v23Gate = parseUpdateCheckResponse(
    {
      decision: 'SOFT',
      soft_update: true,
      latest_version_code: 24,
      playstore_url: 'https://play.google.com/store/apps/details?id=com.burudanitv.app',
    },
    { installedVersionCode: 23 },
  );
  assert('v23 below 24 → SOFT', v23Gate?.decision === 'SOFT');
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

async function verifyPublishedTargetRange() {
  const latest = 21;
  const belowLatest = [16, 17, 18, 19, 20];
  const onLatest = 21;
  console.log(`\n[live API] published target (simulated latest_version_code=${latest})`);
  for (const installed of [...belowLatest, onLatest]) {
    const { status, body } = await fetchUpdateCheck(installed, 'com.burudanitv.app');
    if (!body) {
      assert(`live API body for v${installed}`, false);
      continue;
    }
    const simulated = { ...body, latest_version_code: latest, version_code: latest };
    const out = parseUpdateCheckResponse(simulated, { installedVersionCode: installed });
    if (installed < latest) {
      assert(`v${installed} below ${latest} → update UI when admin SOFT`, out?.decision !== 'NONE');
      console.log(`  v${installed} HTTP ${status} → decision=${out?.decision} latest=${out?.latestVersionCode}`);
    } else {
      assert(`v${installed} on latest → NONE`, out?.decision === 'NONE');
      console.log(`  v${installed} HTTP ${status} → decision=${out?.decision} latest=${out?.latestVersionCode}`);
    }
  }

  console.log('\n[live API] raw backend (no client gate simulation)');
  for (const installed of [20, 21]) {
    const { status, body } = await fetchUpdateCheck(installed, 'com.burudanitv.app');
    if (!body) continue;
    const out = parseUpdateCheckResponse(body, { installedVersionCode: installed });
    console.log(
      `  v${installed} raw latest=${out?.latestVersionCode} decision=${out?.decision} (admin=${body.decision})`,
    );
    if (installed >= (out?.latestVersionCode ?? 0) && out?.latestVersionCode > 0) {
      assert(`v${installed} raw on-or-above parsed latest → NONE`, out?.decision === 'NONE');
    }
  }
}

async function main() {
  console.log('[verify-update-check] strict latest_version_code gate\n');
  unitTests();
  await verifyPublishedTargetRange();

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
