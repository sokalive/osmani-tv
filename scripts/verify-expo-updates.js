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
assert(expo.updates?.checkAutomatically === 'ON_LOAD', 'checkAutomatically must be ON_LOAD');
assert(Number(expo.updates?.fallbackToCacheTimeout) >= 0, 'fallbackToCacheTimeout required');

assert(eas.build?.production?.channel === 'production', 'production build channel missing');
assert(eas.build?.preview?.channel === 'preview', 'preview build channel missing');
assert(eas.build?.development?.channel === 'development', 'development build channel missing');
assert(
  eas.update === undefined,
  'eas.json must not define top-level "update" (use build.channel + eas update --channel)',
);

assert(
  expo.plugins?.includes('expo-updates'),
  'expo-updates config plugin must be listed in app.config.js plugins',
);

console.log('[verify-expo-updates] ok', {
  version: expo.version,
  runtimePolicy: expo.runtimeVersion.policy,
  updatesUrl: expo.updates.url,
  productionChannel: eas.build.production.channel,
});
