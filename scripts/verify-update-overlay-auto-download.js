#!/usr/bin/env node
'use strict';

/**
 * Auto-download update overlay: modal lock during APK fetch, cancel hidden, buttons pinned.
 * Run: node scripts/verify-update-overlay-auto-download.js
 */

const fs = require('fs');
const path = require('path');

const overlay = fs.readFileSync(path.join(__dirname, '..', 'components', 'UpdateOverlay.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'lib', 'updateClient.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (!/function isAutoDownloadInProgress\(\)[\s\S]*?lastUiState\.downloaded/.test(client)) {
  fail('isAutoDownloadInProgress must block until downloaded');
} else pass('isAutoDownloadInProgress blocks until download complete');

if (!client.includes('if (isAutoDownloadInProgress()) return;')) {
  fail('dismissSoft must block during auto-download');
} else pass('dismissSoft blocked during auto-download');

if (!client.includes('if (isAutoDownloadInProgress()) return;') || !client.includes('export function cancelDownload')) {
  // cancelDownload block checked below
}

if (!/export function cancelDownload[\s\S]*?isAutoDownloadInProgress/.test(client)) {
  fail('cancelDownload must block during auto-download');
} else pass('cancelDownload blocked during auto-download');

if (!overlay.includes('autoDownloadLock')) fail('UpdateOverlay autoDownloadLock');
else pass('UpdateOverlay autoDownloadLock');

if (!overlay.includes('!autoDownloadLock')) fail('cancel hidden during auto-download');
else pass('cancel hidden during auto-download');

if (!overlay.includes('blockDismiss')) fail('blockDismiss for backdrop/back');
else pass('blockDismiss prevents backdrop dismiss');

if (!overlay.includes('styles.buttonStack')) fail('buttons must be outside scroll area');
else pass('buttons pinned outside ScrollView');

if (!overlay.includes('styles.messageScroll')) fail('message scroll region required');
else pass('message scroll region for long admin text');

if (!overlay.includes('styles.pinnedMeta')) fail('version/progress must be pinned outside ScrollView');
else pass('pinnedMeta keeps version and progress visible');

if (!overlay.includes('isAutoDownloadBlocking')) fail('isAutoDownloadBlocking helper required');
else pass('isAutoDownloadBlocking covers full auto-download session');

if (!process.exitCode) {
  console.log('\n[verify-update-overlay-auto-download] ok');
}
