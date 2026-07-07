#!/usr/bin/env node
'use strict';

/**
 * Channel catalog FREE/PREMIUM realtime propagation.
 * Run: node scripts/verify-channel-catalog-realtime.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

let pass = 0;
let fail = 0;

function ok(msg) {
  pass += 1;
  console.log('PASS:', msg);
}

function bad(msg) {
  fail += 1;
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function sim(name, cond) {
  if (cond) ok(`sim: ${name}`);
  else bad(`sim: ${name}`);
}

const realtime = read('lib/realtimeSync.js');
const ctx = read('context/OsmaniAppContext.jsx');
const app = read('App.js');
const reconcile = read('lib/subscriptionReconcile.js');

if (realtime.includes('emit(innerName, unwrapped.inner')) ok('SSE inner event fan-out');
else bad('SSE inner event fan-out');

if (ctx.includes('applyChannelCatalogRealtime')) ok('context applies channel access patches');
else bad('context applies channel access patches');

if (ctx.includes('catalogRevision')) ok('catalogRevision state');
else bad('catalogRevision state');

if (app.includes('catalogRevision')) ok('App extraData catalogRevision');
else bad('App extraData catalogRevision');

if (reconcile.includes("'sync'")) ok('sync in immediate channel SSE set');
else bad('sync in immediate channel SSE set');

if (reconcile.includes('channel_access_changed')) ok('channel_access_changed immediate');
else bad('channel_access_changed immediate');

const {
  applyChannelAccessPatches,
  parseChannelAccessRealtimePatches,
  channelAccessPatchIsNewer,
} = require('../lib/channelCatalogRealtime');

const base = [
  { id: '1', name: 'BeIN', accessType: 'premium', accessPremium: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: '2', name: 'Azam', accessType: 'free', accessPremium: false, updatedAt: '2026-01-01T00:00:00.000Z' },
];

sim('PREMIUM→FREE patch', () => {
  const patches = parseChannelAccessRealtimePatches('channel_updated', {
    event: 'channel_updated',
    payload: { id: '1', accessType: 'free', accessPremium: false, updatedAt: '2026-07-07T12:00:00.000Z' },
  });
  const { channels, changed } = applyChannelAccessPatches(base, patches);
  return changed && channels[0].accessType === 'free' && channels[0].accessPremium === false;
});

sim('FREE→PREMIUM patch', () => {
  const patches = parseChannelAccessRealtimePatches('channel_access_changed', {
    id: '2',
    accessType: 'premium',
    accessPremium: true,
    updated_at: '2026-07-07T12:01:00.000Z',
  });
  const { channels, changed } = applyChannelAccessPatches(base, patches);
  return changed && channels[1].accessType === 'premium' && channels[1].accessPremium === true;
});

sim('stale revision rejected', () => {
  const patches = parseChannelAccessRealtimePatches('channel_updated', {
    id: '1',
    accessType: 'free',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });
  const newer = { ...base[0], updatedAt: '2026-07-07T12:00:00.000Z' };
  return channelAccessPatchIsNewer(patches[0], newer) === false;
});

sim('wrapped sync envelope', () => {
  const patches = parseChannelAccessRealtimePatches('sync', {
    event: 'channel_updated',
    payload: { channel: { id: '1', accessType: 'free', accessPremium: false } },
  });
  return patches.length === 1 && patches[0].accessType === 'free';
});

sim('20 rapid toggles final newest wins', () => {
  let channels = base;
  for (let i = 0; i < 20; i += 1) {
    const premium = i % 2 === 0;
    const patches = parseChannelAccessRealtimePatches('channel_updated', {
      id: '1',
      accessType: premium ? 'premium' : 'free',
      accessPremium: premium,
      updatedAt: `2026-07-07T12:00:${String(i).padStart(2, '0')}.000Z`,
    });
    channels = applyChannelAccessPatches(channels, patches).channels;
  }
  const row = channels.find((c) => String(c.id) === '1');
  return row.accessType === 'free' && row.accessPremium === false;
});

console.log(`\n[verify-channel-catalog-realtime] pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
