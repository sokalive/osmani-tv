#!/usr/bin/env node
'use strict';

/**
 * SINGLE production OTA release workflow for VersionCode 24 / Runtime 1.8.2.
 *
 * Always publishes the same JS bundle to:
 *   preview | vps-preview | production
 *
 * Steps:
 *  1) preflight (runtime / versionCode / eas channels / forbid single-channel npm scripts)
 *  2) publish all required channels
 *  3) postflight channel parity (FAIL if diverge)
 *
 * Usage:
 *   npm run ota:production -- --message "fix(prod): describe change"
 *   node scripts/publish-production-ota.js --message "fix(prod): describe change"
 *
 * Flags:
 *   --message <text>   required update message
 *   --dry-run          preflight + parity only (no publish)
 */

const path = require('path');
const {
  assertPreflight,
  publishRuntimeToRequiredChannels,
  verifyChannelParity,
  writeJson,
  RUNTIME_V24,
  VERSION_CODE_V24,
  REQUIRED_CHANNELS,
  gitHead,
} = require('./lib/otaV24Production');

function parseArgs(argv) {
  const out = { message: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--message' || a === '-m') {
      out.message = String(argv[i + 1] || '');
      i += 1;
    } else if (a.startsWith('--message=')) {
      out.message = a.slice('--message='.length);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preflight = assertPreflight({ runtime: RUNTIME_V24, versionCode: VERSION_CODE_V24 });
  console.log('[ota:production] preflight ok', {
    commit: preflight.commit,
    runtime: RUNTIME_V24,
    versionCode: VERSION_CODE_V24,
    channels: REQUIRED_CHANNELS,
  });

  if (args.dryRun) {
    const parity = verifyChannelParity({ runtime: RUNTIME_V24 });
    console.log('[ota:production] dry-run parity ok', parity.parityKey);
    process.exit(0);
  }

  if (!args.message.trim()) {
    console.error('Missing --message. Example:');
    console.error('  npm run ota:production -- --message "fix(prod): describe change"');
    process.exit(1);
  }

  const published = publishRuntimeToRequiredChannels({
    runtime: RUNTIME_V24,
    message: args.message.trim(),
  });

  const parity = verifyChannelParity({ runtime: RUNTIME_V24 });

  const summary = {
    timestamp: new Date().toISOString(),
    workflow: 'ota:production',
    commit: gitHead(),
    runtime: RUNTIME_V24,
    versionCode: VERSION_CODE_V24,
    channels: REQUIRED_CHANNELS,
    message: args.message.trim(),
    groups: published.groups.map((g) => ({
      channel: g.channel,
      groupId: g.groupId,
      androidUpdateId: g.androidUpdateId,
    })),
    parity,
  };

  const summaryPath = writeJson('ota-publish-production-summary.json', summary);
  console.log('\n[ota:production] DONE — all required channels published + parity verified');
  console.log(JSON.stringify(summary.groups, null, 2));
  console.log(`[ota:production] wrote ${path.basename(summaryPath)}`);
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
