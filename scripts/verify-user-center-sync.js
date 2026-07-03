#!/usr/bin/env node
'use strict';

/**
 * Admin User Center sync wiring — static checks only.
 * Run: node scripts/verify-user-center-sync.js
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

const sync = read('api/userCenterSync.js');
const envelope = read('lib/userCenterDeviceEnvelope.js');
const sse = read('lib/adminSseRefreshEvents.js');
const realtime = read('lib/realtimeSync.js');
const app = read('App.js');
const ctx = read('context/OsmaniAppContext.jsx');
const payload = read('lib/deviceIntelligencePayload.js');

if (!sync.includes('reportUserCenterEvent')) fail('userCenterSync API');
else pass('userCenterSync API');

if (!sync.includes('/api/user-center/events')) fail('user-center events route');
else pass('user-center events route');

if (!sync.includes('/api/user-center/login')) fail('login history route');
else pass('login history route');

if (!sync.includes('/api/payments/events')) fail('payment events route');
else pass('payment events route');

if (!envelope.includes('stable_hardware_id')) fail('stable hardware in envelope');
else pass('stable hardware in envelope');

if (!envelope.includes('install_instance_id')) fail('install instance in envelope');
else pass('install instance in envelope');

if (!envelope.includes('timezone')) fail('timezone in envelope');
else pass('timezone in envelope');

if (!sse.includes('USER_CENTER_SSE_EVENTS')) fail('USER_CENTER_SSE_EVENTS');
else pass('USER_CENTER_SSE_EVENTS');

if (!realtime.includes('USER_CENTER_SSE_EVENTS')) fail('realtime registers user center SSE');
else pass('realtime user center SSE whitelist');

if (!realtime.includes('config.settings_changed')) fail('config.settings_changed whitelist');
else pass('config.settings_changed whitelist');

if (!app.includes('bootUserCenterSync')) fail('App boot user center sync');
else pass('App boot user center sync');

if (!app.includes('reportLoginHistory')) fail('App resume login history');
else pass('App resume login history');

if (!ctx.includes('USER_CENTER_SSE_EVENTS')) fail('context user center SSE handler');
else pass('context user center SSE handler');

if (!ctx.includes('registerDeviceIntelligence')) fail('context refreshes device intel on user center SSE');
else pass('context device intel on user center SSE');

if (!payload.includes('stable_hardware_id')) fail('users-intelligence payload extended');
else pass('users-intelligence payload extended');

const premium = read('lib/premiumChannelNavigation.js');
const modal = read('components/PremiumModal.js');
const player = read('screens/ChannelPlayerScreen.js');
const presence = read('lib/presenceTracker.js');

if (!premium.includes('premium_subscribed_cache_fast')) fail('premium unlock navigation telemetry');
else pass('premium unlock navigation telemetry');

if (!modal.includes('reportPaymentTelemetry')) fail('PremiumModal payment telemetry');
else pass('PremiumModal payment telemetry');

if (!player.includes('playback_start')) fail('player playback telemetry');
else pass('player playback telemetry');

if (!presence.includes('reportLogoutHistory')) fail('presence logout telemetry');
else pass('presence logout telemetry');

if (!process.exitCode) {
  console.log('\n[verify-user-center-sync] ok');
}
