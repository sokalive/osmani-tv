#!/usr/bin/env node
'use strict';

/**
 * Verifies APK installer restore split (update checks vs sideload).
 * Run: node scripts/verify-apk-installer-restore.js
 */

process.env.EXPO_PUBLIC_APK_INSTALLER_ENABLED = '0';
const frozen = require('../lib/apkInstallerConfig');

if (!frozen.isApkUpdateCheckEnabled()) {
  console.error('FAIL: update checks must stay enabled on Play-frozen builds');
  process.exit(1);
}
if (frozen.isApkSideloadInstallEnabled()) {
  console.error('FAIL: sideload must be off when build env is 0 and no remote override');
  process.exit(1);
}

frozen.applyRemoteApkInstallerConfig({ apk_installer_enabled: true });
if (!frozen.isApkSideloadInstallEnabled()) {
  console.error('FAIL: remote true must enable sideload');
  process.exit(1);
}

delete process.env.EXPO_PUBLIC_APK_INSTALLER_ENABLED;
delete require.cache[require.resolve('../lib/apkInstallerConfig')];
const fresh = require('../lib/apkInstallerConfig');

if (!fresh.isApkUpdateCheckEnabled() || !fresh.isApkSideloadInstallEnabled()) {
  console.error('FAIL: default OTA bundle must enable checks and sideload');
  process.exit(1);
}

console.log('[verify-apk-installer-restore] ok');
