#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

const PUBLISHED_PLAY_VERSION_CODE = 24;

function isInstructionVideoChannel(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.instruction_video === true || row.instructionVideo === true) return true;
  return String(row.name ?? '').trim().toLowerCase() === 'video';
}

function pickVisibilityMode(row) {
  const raw =
    row?.video_visibility ?? row?.videoVisibility ?? row?.instruction_video_visibility ?? 'all';
  const t = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['below_v24', 'below_latest', 'legacy_only'].includes(t)) return 'below_v24';
  if (['hide_v24', 'hide_from_v24', 'hide_latest', 'latest_only'].includes(t)) return 'hide_v24';
  return 'all';
}

function instructionVideoVisibleForInstall(row, vc) {
  if (!isInstructionVideoChannel(row)) return true;
  const mode = pickVisibilityMode(row);
  if (mode === 'below_v24' || mode === 'hide_v24') return vc > 0 && vc < PUBLISHED_PLAY_VERSION_CODE;
  return true;
}

const video = { name: 'VIDEO', accessType: 'premium' };
if (!isInstructionVideoChannel(video)) fail('VIDEO name detect');
else pass('VIDEO name detect');

if (!instructionVideoVisibleForInstall({ name: 'VIDEO', video_visibility: 'all' }, 24)) {
  fail('visibility all for v24');
} else pass('visibility all for v24');

if (instructionVideoVisibleForInstall({ name: 'VIDEO', video_visibility: 'below_v24' }, 24)) {
  fail('below_v24 hides on v24');
} else pass('below_v24 hides on v24');

if (!instructionVideoVisibleForInstall({ name: 'VIDEO', video_visibility: 'below_v24' }, 20)) {
  fail('below_v24 shows on v20');
} else pass('below_v24 shows on v20');

if (instructionVideoVisibleForInstall({ name: 'VIDEO', video_visibility: 'hide_v24' }, 24)) {
  fail('hide_v24 hides on v24');
} else pass('hide_v24 hides on v24');

const playerSrc = fs.readFileSync(path.join(root, 'lib/playerChannelFromRow.js'), 'utf8');
if (!playerSrc.includes('enrichPlayerChannelInstructionVideo')) fail('player enrich');
else pass('player enrich');

const ctx = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');
if (!ctx.includes('PORTRAIT_UP')) fail('player portrait lock');
else pass('player portrait lock');
if (!ctx.includes('resolveInstructionVideoPlaybackUri')) fail('offline cache hook');
else pass('offline cache hook');

const nav = fs.readFileSync(path.join(root, 'lib/premiumChannelNavigation.js'), 'utf8');
if (!nav.includes('isInstructionVideoChannel')) fail('nav bypass update gate');
else pass('nav bypass update gate');

const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
if (!app.includes('instructionVideoVisibleForInstall')) fail('catalog visibility filter');
else pass('catalog visibility filter');

if (!process.exitCode) console.log('\n[verify-instruction-video-channel] ok');
