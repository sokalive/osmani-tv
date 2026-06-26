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
  const kind = String(row.channel_kind ?? row.channelKind ?? '').trim().toLowerCase();
  if (kind === 'instruction_video') return true;
  if (row.instruction_video === true || row.instructionVideo === true) return true;
  return String(row.name ?? '').trim().toLowerCase() === 'video';
}

function pickVisibilityMode(row) {
  const raw =
    row?.video_visibility ?? row?.videoVisibility ?? row?.instruction_video_visibility ?? 'all';
  const t = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['below_v24', 'below_latest', 'legacy_only'].includes(t)) return 'below_v24';
  if (['hide_v24', 'hide_from_v24', 'hide_latest', 'latest_only', 'hide_v24_plus'].includes(t)) {
    return 'hide_v24';
  }
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

const kindRow = { channel_kind: 'instruction_video', name: 'Other' };
if (!isInstructionVideoChannel(kindRow)) fail('channel_kind detect');
else pass('channel_kind detect');

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

const instr = fs.readFileSync(path.join(root, 'lib/instructionVideoChannel.js'), 'utf8');
if (!instr.includes('pickInstructionVideoUrl')) fail('pickInstructionVideoUrl');
else pass('pickInstructionVideoUrl');
if (!instr.includes('resolveInstructionVideoUrl')) fail('resolveInstructionVideoUrl');
else pass('resolveInstructionVideoUrl');

const playerSrc = fs.readFileSync(path.join(root, 'lib/playerChannelFromRow.js'), 'utf8');
if (!playerSrc.includes('resolveInstructionVideoUrl')) fail('player uses video url');
else pass('player uses video url');

const ctx = fs.readFileSync(path.join(root, 'screens/ChannelPlayerScreen.js'), 'utf8');
if (!ctx.includes('PORTRAIT_UP')) fail('player portrait lock');
else pass('player portrait lock');
if (!ctx.includes('resolveInstructionVideoPlaybackUri')) fail('offline cache hook');
else pass('offline cache hook');
if (!ctx.includes("if (isInstructionVideo) return 'native'")) fail('instruction native route');
else pass('instruction native route');
if (!ctx.includes('Video ya maelekezo haijapatikana')) fail('instruction swahili 404');
else pass('instruction swahili 404');

const nav = fs.readFileSync(path.join(root, 'lib/premiumChannelNavigation.js'), 'utf8');
if (!nav.includes("path: 'instruction_video'")) fail('nav instruction bypass');
else pass('nav instruction bypass');

const trial = fs.readFileSync(path.join(root, 'lib/trialWatchAccess.js'), 'utf8');
if (!trial.includes('isInstructionVideoChannel')) fail('trial free access');
else pass('trial free access');

const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
if (!app.includes('instructionVideoVisibleForInstall')) fail('catalog visibility filter');
else pass('catalog visibility filter');

if (!process.exitCode) console.log('\n[verify-instruction-video-channel] ok');
