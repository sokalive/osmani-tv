#!/usr/bin/env node
'use strict';

/**
 * Mandatory update overlay (Force + Auto Download): no cancel, no dismiss until current.
 * Run: node scripts/verify-update-overlay-auto-download.js
 */

const fs = require('fs');
const path = require('path');

const overlay = fs.readFileSync(path.join(__dirname, '..', 'components', 'UpdateOverlay.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'lib', 'updateClient.js'), 'utf8');
const policy = fs.readFileSync(path.join(__dirname, '..', 'lib', 'updateMandatoryPolicy.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (!policy.includes('isMandatoryUpdate')) fail('updateMandatoryPolicy exports isMandatoryUpdate');
else pass('updateMandatoryPolicy module');

if (!policy.includes('auto_download')) fail('auto_download alias in mandatory policy');
else pass('auto_download alias supported');

const { isMandatoryUpdate, hasAutoDownloadEnabled } = require('../lib/updateMandatoryPolicy');
if (!isMandatoryUpdate({ autoDownload: true }, 'SOFT')) fail('SOFT + autoDownload is mandatory');
else pass('SOFT + autoDownload is mandatory');
if (isMandatoryUpdate({ auto_download: true }, 'SOFT')) pass('auto_download alias triggers mandatory');
else fail('auto_download alias triggers mandatory');
if (!isMandatoryUpdate({}, 'FORCE')) fail('FORCE is mandatory');
else pass('FORCE is mandatory');
if (isMandatoryUpdate({}, 'SOFT')) fail('plain SOFT is not mandatory');
else pass('plain SOFT allows cancel');
if (hasAutoDownloadEnabled({ auto_download: true })) pass('hasAutoDownloadEnabled alias');
else fail('hasAutoDownloadEnabled alias');

if (!/function isMandatorySessionActive\(\)/.test(client)) {
  fail('isMandatorySessionActive required in updateClient');
} else pass('isMandatorySessionActive blocks dismiss for full mandatory session');

if (!client.includes('if (isMandatorySessionActive()) return;')) {
  fail('dismissSoft must block during mandatory session');
} else pass('dismissSoft blocked during mandatory session');

if (!/export function cancelDownload[\s\S]*?isMandatorySessionActive/.test(client)) {
  fail('cancelDownload must block during mandatory session');
} else pass('cancelDownload blocked during mandatory session');

if (!client.includes('softUpdateDismissed && !mandatory')) {
  fail('soft dismiss must not hide mandatory auto-download overlay');
} else pass('softUpdateDismissed ignored when mandatory');

if (!overlay.includes('isMandatoryUpdate')) fail('UpdateOverlay uses isMandatoryUpdate');
else pass('UpdateOverlay isMandatoryUpdate');

if (!overlay.includes('mandatoryUpdate')) fail('UpdateOverlay mandatoryUpdate flag');
else pass('UpdateOverlay mandatoryUpdate derived flag');

if (!overlay.includes('showCancel = !mandatoryUpdate')) {
  fail('Cancel hidden for all mandatory updates');
} else pass('Cancel hidden when mandatory');

if (!overlay.includes('blockDismiss')) fail('blockDismiss for backdrop/back');
else pass('blockDismiss prevents backdrop dismiss');

if (!overlay.includes('isAutoDownloadBlocking')) fail('isAutoDownloadBlocking helper retained');
else pass('isAutoDownloadBlocking alias retained');

if (!overlay.includes('styles.buttonStack')) fail('buttons must be outside scroll area');
else pass('buttons pinned outside ScrollView');

if (!process.exitCode) {
  console.log('\n[verify-update-overlay-auto-download] ok');
}
