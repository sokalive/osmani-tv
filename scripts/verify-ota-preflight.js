#!/usr/bin/env node
'use strict';

/**
 * Pre-publish gate for VersionCode 24 / Runtime 1.8.2 OTA releases.
 * Fails immediately if runtime, channels, or package scripts are inconsistent.
 *
 * Usage: node scripts/verify-ota-preflight.js
 */

const {
  assertPreflight,
  REQUIRED_CHANNELS,
  RUNTIME_V24,
  VERSION_CODE_V24,
} = require('./lib/otaV24Production');

try {
  const result = assertPreflight({ runtime: RUNTIME_V24, versionCode: VERSION_CODE_V24 });
  console.log('[verify-ota-preflight] ok', {
    runtime: result.runtime,
    versionCode: result.versionCode,
    channels: REQUIRED_CHANNELS,
    commit: result.commit,
  });
  process.exit(0);
} catch (err) {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
}
