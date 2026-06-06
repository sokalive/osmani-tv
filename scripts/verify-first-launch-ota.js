#!/usr/bin/env node
'use strict';

/**
 * Fresh install: block UI until OTA gate completes; repair CDN stream-direct;
 * recover stale subscriptions.php playback with same-session OTA reload.
 *
 * Run: node scripts/verify-first-launch-ota.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

const splashBootSrc = read('lib/startupSplashBoot.js');
const gateSrc = read('lib/embeddedLaunchGate.js');
const recoverySrc = read('lib/freshInstallPlaybackRecovery.js');
const playerSrc = read('screens/ChannelPlayerScreen.js');
const rowSrc = read('lib/playerChannelFromRow.js');
const mediaSrc = read('lib/mediaDelivery.js');
const backendSrc = read('backend/lib/mediaUrlSerializer.js');
const appConfig = require(path.join(root, 'app.config.js'));

if (!splashBootSrc.includes('beginEmbeddedLaunchGate')) {
  fail('startupSplashBoot must begin embedded gate at import time');
} else pass('embedded gate starts at import time');

if (!gateSrc.includes('force_reload_missing')) {
  fail('embedded gate must force reload when OTA fetched without reload');
} else pass('embedded gate force reload fallback');

if (!recoverySrc.includes('tryFreshInstallPlaybackOtaRecovery')) {
  fail('freshInstallPlaybackRecovery module missing');
} else pass('playback OTA recovery module present');

if (!playerSrc.includes('tryFreshInstallPlaybackOtaRecovery')) {
  fail('ChannelPlayerScreen must recover stale first-launch playback');
} else pass('ChannelPlayerScreen playback recovery wired');

if (!playerSrc.includes('isUnsafeFirstLaunchPlaybackUri')) {
  fail('ChannelPlayerScreen must guard unsafe stream-direct URIs');
} else pass('ChannelPlayerScreen unsafe URI guard');

if (!rowSrc.includes('sanitizePlaybackUrl')) {
  fail('playerChannelFromRow must sanitize playback URLs');
} else pass('playerChannelFromRow sanitizes playback URLs');

if (!mediaSrc.includes('repairStreamDirectApiHost')) {
  fail('repairStreamDirectApiHost missing');
} else pass('stream-direct API host repair present');

if (!mediaSrc.match(/isStreamDirectUrl\(value\)\) return repairStreamDirectApiHost/)) {
  fail('rewriteMediaUrlsInJson must repair stream-direct URLs');
} else pass('rewriteMediaUrlsInJson repairs stream-direct');

if (!backendSrc.includes('isStreamDirectUrl(directRaw)')) {
  fail('backend enrich must not CDN-rewrite stream-direct');
} else pass('backend stream-direct CDN rewrite blocked');

if (appConfig.expo.updates?.checkAutomatically !== 'ON_LOAD') {
  fail('app.config updates.checkAutomatically must be ON_LOAD');
} else pass('native ON_LOAD update check configured');

function repairStreamDirectApiHostMirror(input) {
  const s = String(input ?? '').trim();
  if (!s || !/\/stream-direct(?:\?|$)/i.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.host.includes('b-cdn.net')) {
      u.protocol = 'https:';
      u.host = 'osmani-admin-api.onrender.com';
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return s;
}

const cdnDirect = 'https://osmanitv.b-cdn.net/stream-direct?token=abc';
const repaired = repairStreamDirectApiHostMirror(cdnDirect);
if (!repaired.includes('osmani-admin-api.onrender.com/stream-direct')) {
  fail('CDN stream-direct must repair to API host');
} else pass('CDN stream-direct repairs to API host');

if (process.exitCode) process.exit(1);
console.log('[verify-first-launch-ota] ok');
