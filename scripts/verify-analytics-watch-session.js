#!/usr/bin/env node
'use strict';

/**
 * Channel watch analytics: per-view session id, enriched payloads, immediate heartbeat.
 * Run: node scripts/verify-analytics-watch-session.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const analytics = fs.readFileSync(path.join(root, 'api', 'analytics.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'screens', 'ChannelPlayerScreen.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (!analytics.includes('watch_session_id')) fail('watch_session_id in analytics payloads');
else pass('watch_session_id field');

if (!analytics.includes('session_id: watchSessionId')) fail('session_id on channel watch');
else pass('session_id on channel watch');

if (!analytics.includes('version_code')) fail('version_code in channel watch payloads');
else pass('version_code in payloads');

if (!analytics.includes('api_host')) fail('api_host in channel watch payloads');
else pass('api_host in payloads');

if (!analytics.includes('getApiBaseUrl()')) fail('dynamic API host at request time');
else pass('dynamic API host');

if (!/startLiveSession[\s\S]*?pingLiveSession/.test(analytics)) {
  fail('startLiveSession must send immediate heartbeat');
} else pass('immediate heartbeat after session start');

if (!analytics.includes('readNativeAndroidVersionCode')) fail('versionCode from native');
else pass('native versionCode');

if (!player.includes('sessionWatchIdRef')) fail('player tracks watch session id');
else pass('player watch session ref');

if (!player.includes('channelWatchMeta')) fail('player passes watch meta to ping/stop');
else pass('player channelWatchMeta helper');

if (!player.includes('session.watchSessionId')) {
  fail('player stores watchSessionId from startLiveSession');
} else pass('player stores watchSessionId');

if (!process.exitCode) {
  console.log('\n[verify-analytics-watch-session] ok');
}
