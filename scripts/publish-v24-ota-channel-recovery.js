#!/usr/bin/env node
'use strict';

/**
 * PRODUCTION OTA RECOVERY — VersionCode 24 / Runtime 1.8.2
 *
 * Prefer the permanent workflow for all future releases:
 *   npm run ota:production -- --message "fix(prod): ..."
 *
 * This recovery script remains as an explicit full-sync republish helper
 * and uses the same multi-channel policy + parity gates.
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

assertPreflight({ runtime: RUNTIME_V24, versionCode: VERSION_CODE_V24 });

const published = publishRuntimeToRequiredChannels({
  runtime: RUNTIME_V24,
  message: 'fix(ota): v24 channel recovery — sync all 1.8.2 installs',
});

const parity = verifyChannelParity({ runtime: RUNTIME_V24 });

const summary = {
  timestamp: new Date().toISOString(),
  commit: gitHead(),
  runtime: RUNTIME_V24,
  versionCode: VERSION_CODE_V24,
  channels: REQUIRED_CHANNELS,
  groups: published.groups.map((g) => ({
    channel: g.channel,
    runtime: g.runtime,
    groupId: g.groupId,
    androidUpdateId: g.androidUpdateId,
  })),
  parity,
  rootCause:
    'Identical versionCode 24 / runtime 1.8.2 APKs are baked with different expo-channel-name values (preview | vps-preview | production). OTA published to only one channel never reaches the others.',
};

writeJson('ota-publish-v24-channel-recovery-summary.json', summary);
console.log('\n[publish-v24-ota-channel-recovery] DONE');
console.log(JSON.stringify(summary.groups, null, 2));
console.log(`[parity] ${parity.parityKey}`);
