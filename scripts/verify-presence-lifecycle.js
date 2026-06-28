#!/usr/bin/env node
'use strict';

/**
 * Live analytics presence lifecycle guards.
 * Run: node scripts/verify-presence-lifecycle.js
 */

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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const tracker = read('lib/presenceTracker.js');
const analytics = read('api/analytics.js');
const player = read('screens/ChannelPlayerScreen.js');
const app = read('App.js');

if (!app.includes('startPresence()')) fail('App.js must start presence on boot');
else pass('app boot starts presence');

if (!tracker.includes('resetActiveChannelRefs')) fail('presenceTracker clears channel refs on stop');
else pass('presenceTracker resetActiveChannelRefs');

if (!/background grace elapsed[\s\S]*resetActiveChannelRefs/.test(tracker)) {
  fail('background stop must clear channel refs');
} else pass('background stop clears channel refs');

if (!tracker.includes("'inactive'")) fail('presence must ignore inactive AppState');
else pass('inactive AppState ignored');

if (!analytics.includes('SESSION_HEARTBEAT_RETRIES_MS')) {
  fail('presence heartbeat must use session retry schedule');
} else pass('presence heartbeat retries');

if (!/pingAppPresence[\s\S]*SESSION_HEARTBEAT_RETRIES_MS/.test(analytics)) {
  fail('pingAppPresence must use SESSION_HEARTBEAT_RETRIES_MS');
} else pass('pingAppPresence retry schedule');

if (!/stopAppPresence[\s\S]*SESSION_HEARTBEAT_RETRIES_MS/.test(analytics)) {
  fail('stopAppPresence must use SESSION_HEARTBEAT_RETRIES_MS');
} else pass('stopAppPresence retry schedule');

if (!/await stopLiveSession[\s\S]*clearActiveChannel/.test(player)) {
  fail('player must await stopLiveSession before clearActiveChannel');
} else pass('player stop before channel clear');

if (!/stopLiveSession[\s\S]*clearActiveChannel/.test(player)) {
  fail('player background stop must clear active channel');
} else pass('player background clears channel');

if (!player.includes('setActiveChannel(channelId, channelName)')) {
  fail('player must set active channel on mount');
} else pass('player sets channel on mount');

if (!tracker.includes('stopHeartbeat()')) fail('presence must stop heartbeat timer');
else pass('presence stops heartbeat timer');

if (!player.includes('clearInterval(pingTimerRef.current)')) {
  fail('player must clear ping timer');
} else pass('player clears ping timer');

console.log('\n[verify-presence-lifecycle] done');
