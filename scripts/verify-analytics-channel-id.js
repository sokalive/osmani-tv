#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function fail(m) {
  console.error('FAIL:', m);
  process.exitCode = 1;
}
function pass(m) {
  console.log('PASS:', m);
}

const player = fs.readFileSync(path.join(__dirname, '../screens/ChannelPlayerScreen.js'), 'utf8');
const helper = fs.readFileSync(path.join(__dirname, '../lib/analyticsChannelId.js'), 'utf8');

if (!helper.includes('resolveAnalyticsChannelId')) fail('analyticsChannelId helper');
else pass('analyticsChannelId helper');

if (!player.includes('resolveAnalyticsChannelId')) fail('player uses resolveAnalyticsChannelId');
else pass('player uses resolveAnalyticsChannelId');

if (player.includes("?? channel?.name ?? 'unknown'")) fail('player must not use channel name as channel_id');
else pass('no channel name fallback for analytics id');

if (!process.exitCode) console.log('\n[verify-analytics-channel-id] ok');
