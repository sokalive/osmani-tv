#!/usr/bin/env node
'use strict';

/**
 * Live EAS channel-parity gate for runtime 1.8.2.
 * Fails if preview / vps-preview / production latest updates diverge.
 *
 * Usage: node scripts/verify-ota-channel-parity.js
 */

const path = require('path');
const {
  verifyChannelParity,
  RUNTIME_V24,
  REQUIRED_CHANNELS,
  writeJson,
} = require('./lib/otaV24Production');

try {
  const result = verifyChannelParity({ runtime: RUNTIME_V24 });
  const outPath = writeJson('ota-channel-parity-report.json', {
    timestamp: new Date().toISOString(),
    ...result,
    requiredChannels: REQUIRED_CHANNELS,
  });
  console.log('[verify-ota-channel-parity] ok', result.parityKey);
  console.log(JSON.stringify(result.latest, null, 2));
  console.log(`[verify-ota-channel-parity] wrote ${path.basename(outPath)}`);
  process.exit(0);
} catch (err) {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
}
