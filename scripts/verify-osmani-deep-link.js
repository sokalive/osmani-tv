#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function pass(msg) {
  console.log('PASS:', msg);
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

const deepLink = read('lib/osmaniDeepLink.js');
const dispatch = read('lib/osmaniDeepLinkDispatch.js');
const openLink = read('lib/openOsmaniDeepLink.js');
const gate = read('components/OsmaniDeepLinkGate.jsx');
const app = read('App.js');
const oneSignal = read('lib/oneSignal.native.js');

if (!deepLink.includes("kind: 'channel'")) fail('parseOsmaniDeepLink channel kind');
else pass('parseOsmaniDeepLink channel kind');

if (!deepLink.includes("kind: 'tab'")) fail('parseOsmaniDeepLink tab kind');
else pass('parseOsmaniDeepLink tab kind');

if (!deepLink.includes("kind: 'custom'")) fail('parseOsmaniDeepLink custom kind');
else pass('parseOsmaniDeepLink custom kind');

if (!openLink.includes('openPremiumChannelFromSnapshot')) {
  fail('channel deep link uses premium navigation gate');
} else pass('channel deep link uses premium navigation gate');

if (!gate.includes('Linking.getInitialURL')) fail('Linking cold start');
else pass('Linking cold start');

if (!gate.includes("Linking.addEventListener('url'")) fail('Linking background url event');
else pass('Linking background url event');

if (!gate.includes('setOsmaniDeepLinkHandler')) fail('OneSignal dispatch bridge');
else pass('OneSignal dispatch bridge');

if (!app.includes('dispatchOsmaniDeepLink')) fail('App wires dispatchOsmaniDeepLink');
else pass('App wires dispatchOsmaniDeepLink');

if (!app.includes('OsmaniDeepLinkGate')) fail('App mounts OsmaniDeepLinkGate');
else pass('App mounts OsmaniDeepLinkGate');

if (!oneSignal.includes('osmani://channel/')) fail('OneSignal channel_id → osmani URL');
else pass('OneSignal channel_id → osmani URL');

// Runtime parse checks (mirror)
const { parseOsmaniDeepLink, resolveMainTabFromOsmaniUrl } = require('../lib/osmaniDeepLink');

const home = parseOsmaniDeepLink('osmani://home');
if (!home || home.kind !== 'tab' || home.tab !== 'Home') {
  fail('osmani://home → Home tab');
} else pass('osmani://home → Home tab');

const channel = parseOsmaniDeepLink('osmani://channel/abc-123');
if (!channel || channel.kind !== 'channel' || channel.channelId !== 'abc-123') {
  fail('osmani://channel/{id} parse');
} else pass('osmani://channel/{id} parse');

const channelPath = parseOsmaniDeepLink('osmani:///channel/xyz');
if (!channelPath || channelPath.kind !== 'channel' || channelPath.channelId !== 'xyz') {
  fail('osmani:///channel/{id} parse');
} else pass('osmani:///channel/{id} parse');

if (resolveMainTabFromOsmaniUrl('osmani://channel/abc') !== null) {
  fail('channel URL must not resolve as tab');
} else pass('channel URL excluded from tab resolver');

const custom = parseOsmaniDeepLink('osmani://promo/summer');
if (!custom || custom.kind !== 'custom') fail('unknown osmani path → custom');
else pass('unknown osmani path → custom');

if (process.exitCode) process.exit(1);
console.log('[verify-osmani-deep-link] ok');
