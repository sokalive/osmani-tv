#!/usr/bin/env node
'use strict';

/**
 * Validates Expo EAS Updates config (no device / network required).
 * Run: node scripts/verify-expo-updates.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appConfig = require(path.join(root, 'app.config.js'));
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const expo = appConfig.expo;

assert(pkg.dependencies['expo-updates'], 'expo-updates dependency missing');
assert(expo.runtimeVersion?.policy === 'appVersion', 'runtimeVersion.policy must be appVersion');
assert(expo.updates?.enabled === true, 'updates.enabled must be true');
assert(
  String(expo.updates?.url || '').includes('u.expo.dev'),
  'updates.url must point at Expo Updates CDN',
);
assert(
  expo.updates?.checkAutomatically === 'ON_LOAD' ||
    expo.updates?.checkAutomatically === 'ON_ERROR_RECOVERY',
  'checkAutomatically must be ON_LOAD or ON_ERROR_RECOVERY',
);
assert(Number(expo.updates?.fallbackToCacheTimeout) >= 0, 'fallbackToCacheTimeout required');

assert(eas.build?.production?.channel === 'production', 'production build channel missing');
assert(eas.build?.preview?.channel === 'preview', 'preview build channel missing');
assert(eas.build?.['vps-preview']?.channel === 'vps-preview', 'vps-preview build channel missing');
assert(eas.build?.development?.channel === 'development', 'development build channel missing');
assert(
  eas.update === undefined,
  'eas.json must not define top-level "update" (use build.channel + eas update --channel)',
);

assert(
  expo.plugins?.includes('expo-updates'),
  'expo-updates config plugin must be listed in app.config.js plugins',
);

// v24 / 1.8.2 installs listen on multiple channels — single-channel npm scripts are forbidden.
const REQUIRED_V24_CHANNELS = ['preview', 'vps-preview', 'production'];
for (const channel of REQUIRED_V24_CHANNELS) {
  assert(
    eas.build?.[channel]?.channel === channel,
    `eas.json build.${channel}.channel must equal "${channel}"`,
  );
}
const scripts = pkg.scripts || {};
for (const [name, cmd] of Object.entries(scripts)) {
  const c = String(cmd);
  assert(
    !/eas\s+update\s+--channel\s+(preview|production|vps-preview)\b/.test(c),
    `package.json script "${name}" must not call eas update for a single channel — use npm run ota:production`,
  );
}
assert(typeof scripts['ota:production'] === 'string', 'package.json missing ota:production');
assert(typeof scripts['verify:ota-preflight'] === 'string', 'package.json missing verify:ota-preflight');
assert(typeof scripts['verify:ota-parity'] === 'string', 'package.json missing verify:ota-parity');

console.log('[verify-expo-updates] ok', {
  version: expo.version,
  runtimePolicy: expo.runtimeVersion.policy,
  updatesUrl: expo.updates.url,
  productionChannel: eas.build.production.channel,
  requiredV24Channels: REQUIRED_V24_CHANNELS,
  otaProductionScript: scripts['ota:production'],
});
