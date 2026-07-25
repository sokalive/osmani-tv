#!/usr/bin/env node
'use strict';

/**
 * VPS v24 — "Kifurushi kimekwisha" popup must never render (Home TransferredAwayModal
 * or ChannelPlayer gate). Stale bundles must OTA-reload via V2 marker.
 * Run: node scripts/verify-remove-kifurushi-kimekwisha-popup.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

let failed = false;
function fail(msg) {
  console.error('FAIL:', msg);
  failed = true;
}
function pass(msg) {
  console.log('PASS:', msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const FORBIDDEN = [
  'Kifurushi kimekwisha',
  'Kifurushi chako kimekwisha',
  'Rejesha kifurushi',
  'Lipia tena au rudisha kifurushi',
];

const SCAN_DIRS = ['App.js', 'components', 'context', 'screens', 'lib', 'hooks'];
const SCAN_EXT = new Set(['.js', '.jsx', '.ts', '.tsx']);

function walk(rel) {
  const abs = path.join(root, rel);
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (!SCAN_EXT.has(path.extname(abs))) return [];
    return [rel];
  }
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    out.push(...walk(path.join(rel, name)));
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(d));
for (const rel of files) {
  // Comments / markers may mention the string; forbid only live UI copy paths.
  if (rel.replace(/\\/g, '/') === 'lib/playbackGateCapability.js') continue;
  if (rel.replace(/\\/g, '/') === 'lib/otaBootGatePolicy.js') continue;
  const src = read(rel);
  for (const needle of FORBIDDEN) {
    if (src.includes(needle)) {
      fail(`${rel} must not contain "${needle}"`);
    }
  }
}
if (!failed) pass('no forbidden popup copy in production app sources');

const app = read('App.js');
if (app.includes('TransferredAwayModal')) {
  fail('App.js must not mount TransferredAwayModal');
} else pass('TransferredAwayModal not in App.js');

if (app.includes('revokedReason') || app.includes('dismissRevoked')) {
  fail('App.js must not wire revokedReason / dismissRevoked');
} else pass('App.js has no revokedReason wiring');

const modal = read('components/TransferredAwayModal.js');
if (modal.includes('Rejesha kifurushi') || modal.includes('LIPIA TENA') || modal.includes('lock-closed')) {
  fail('TransferredAwayModal must remain a null stub');
} else pass('TransferredAwayModal is null stub');
if (!modal.includes('return null')) fail('TransferredAwayModal must return null');
else pass('TransferredAwayModal returns null');

const ctx = read('context/OsmaniAppContext.jsx');
if (ctx.includes('revokedReason') || ctx.includes('setRevokedReason') || ctx.includes('dismissRevoked')) {
  fail('OsmaniAppContext must not keep revokedReason popup state');
} else pass('revokedReason state removed from context');

const player = read('screens/ChannelPlayerScreen.js');
if (/playbackSuppressed|setPlaybackSuppressed/.test(player)) {
  fail('playbackSuppressed state must not re-trigger the removed gate screen');
} else pass('no playbackSuppressed state');

if (!player.includes('trialPlaybackEndedRef') || !player.includes('hardWallClockExpiryDoneRef')) {
  fail('expiry/trial shutdown must use refs without gate re-render');
} else pass('shutdown uses refs only');

const marker = read('lib/playbackGateCapability.js');
if (!marker.includes('KIFURUSHI_KIMEKWISHA_GATE_REMOVED')) {
  fail('playbackGateCapability marker missing');
} else pass('OTA capability marker present');
if (!marker.includes('KIFURUSHI_KIMEKWISHA_POPUP_REMOVED_V2')) {
  fail('V2 popup-removal marker missing');
} else pass('OTA V2 popup marker present');

const policy = read('lib/otaBootGatePolicy.js');
if (!policy.includes('hasKifurushiKimekwishaGateRemoved')) {
  fail('otaBootGatePolicy must detect missing popup-removal marker');
} else pass('stale bundle detection wired');
if (!policy.includes('hasKifurushiKimekwishaPopupRemovedV2')) {
  fail('otaBootGatePolicy must detect missing V2 popup marker');
} else pass('V2 stale detection wired');

const guard = read('lib/subscriptionSseGuard.js');
if (!/export function resolveSubscriptionLossModalReason[\s\S]*return null/.test(guard)) {
  fail('resolveSubscriptionLossModalReason must always return null');
} else pass('loss modal reason always null');

if (!player.includes('Hauna kifurushi hai')) {
  fail('premium access gate must remain');
} else pass('premium access gate unchanged');

process.exit(failed ? 1 : 0);
