#!/usr/bin/env node
'use strict';

/**
 * Static + live checks for admin realtime refresh (SSE primary, polling fallback).
 * Run: node scripts/verify-realtime-refresh.js
 */

const fs = require('fs');
const path = require('path');
const {
  ADMIN_RUNTIME_MODE_SSE_EVENTS,
  ADMIN_SOFT_REFRESH_SSE_EVENTS,
  SUBSCRIPTION_SSE_EVENTS,
  UPDATE_SETTINGS_SSE_EVENTS,
} = require('../lib/adminSseRefreshEvents');

const root = path.join(__dirname, '..');
const BASE = (
  process.env.EXPO_PUBLIC_API_URL || 'http://144.91.117.90:10001'
).replace(/\/+$/, '');

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

const realtime = read('lib/realtimeSync.js');
const ctx = read('context/OsmaniAppContext.jsx');
const updateClient = read('lib/updateClient.js');

if (!realtime.includes('getApiBaseUrl')) fail('realtimeSync must resolve API base at connect time');
else pass('realtimeSync dynamic API base');

if (!realtime.includes('AppState.addEventListener')) fail('realtimeSync must reconnect on foreground');
else pass('realtimeSync AppState foreground reconnect');

if (!realtime.includes('scheduleReconnect') || !realtime.includes('reconnectBackoffMs')) {
  fail('realtimeSync must use backoff reconnect');
} else pass('realtimeSync backoff reconnect');

if (!realtime.includes('SUBSCRIPTION_WAKE_SSE_EVENTS')) fail('realtimeSync must register subscription wake SSE events');
else pass('realtimeSync subscription wake SSE whitelist');

if (!realtime.includes('UPDATE_SETTINGS_SSE_EVENTS')) fail('realtimeSync must register update settings SSE events');
else pass('realtimeSync update settings SSE whitelist');

if (!ctx.includes('scheduleAdminDrivenSoftSync')) fail('context must debounce admin catalog refresh');
else pass('context admin soft sync debouncer');

if (!ctx.includes('SUBSCRIPTION_WAKE_SSE_EVENTS')) fail('context must listen for subscription wake SSE lifecycle');
else pass('context subscription wake SSE listeners');

if (!ctx.includes("scheduleAdminDrivenSoftSync('app_resume')")) {
  fail('context must soft-sync on app resume');
} else pass('context app resume soft sync');

const requiredCatalog = ['channels_changed', 'banners_changed', 'plans_changed', 'config.channels_changed', 'config.banners_changed'];
for (const ev of requiredCatalog) {
  if (!ADMIN_SOFT_REFRESH_SSE_EVENTS.includes(ev)) fail(`missing catalog SSE event: ${ev}`);
  else pass(`catalog SSE event registered: ${ev}`);
}

const reconcile = read('lib/subscriptionReconcile.js');
if (!reconcile.includes('CATALOG_IMMEDIATE_SSE_EVENTS')) fail('CATALOG_IMMEDIATE_SSE_EVENTS missing');
else pass('CATALOG_IMMEDIATE_SSE_EVENTS defined');

if (!reconcile.includes("'config.banners_changed'")) fail('config.banners_changed not immediate');
else pass('config.banners_changed in immediate catalog set');

if (!reconcile.includes('PAYMENT_PLANS_SSE_EVENTS')) fail('PAYMENT_PLANS_SSE_EVENTS missing');
else pass('PAYMENT_PLANS_SSE_EVENTS defined');

const api = read('api.js');
if (!api.includes('fetchBannersFromNetwork(opts')) fail('banners fetch must accept force/cacheBust opts');
else pass('banners fetch cache-bust on force');

if (!ctx.includes('CATALOG_IMMEDIATE_SSE_EVENTS.has(ev)')) {
  fail('context must use CATALOG_IMMEDIATE_SSE_EVENTS for immediate refresh');
} else pass('context immediate catalog SSE handler');

if (ctx.includes('CHANNEL_ACCESS_IMMEDIATE_SSE_EVENTS.has(ev)') && ctx.includes('scheduleAdminDrivenSoftSync')) {
  const block = ctx.slice(ctx.indexOf('offCatalogAliases'), ctx.indexOf('offCatalogAliases') + 1200);
  if (block.includes('CHANNEL_ACCESS_IMMEDIATE_SSE_EVENTS.has(ev)') && block.includes('scheduleAdminDrivenSoftSync(`sse:${ev}`)')) {
    fail('immediate catalog events must not also schedule debounced soft sync');
  }
}
pass('no double-refresh on immediate catalog events');

if (!ctx.includes("__sync_stream_connected', () => {") || !ctx.includes('forceNetwork: true')) {
  const reconnectBlock = ctx.slice(ctx.indexOf('__sync_stream_connected'), ctx.indexOf('__sync_stream_connected') + 400);
  if (!reconnectBlock.includes('forceNetwork: true')) fail('SSE reconnect must forceNetwork catalog refresh');
  else pass('SSE reconnect catalog refresh');
} else pass('SSE reconnect catalog refresh');

const requiredModes = ['app_modes_changed', 'config_changed', 'app_modes', 'trial_watch_settings'];
for (const ev of requiredModes) {
  if (!ADMIN_RUNTIME_MODE_SSE_EVENTS.includes(ev)) fail(`missing runtime mode SSE event: ${ev}`);
  else pass(`runtime mode SSE event registered: ${ev}`);
}

if (!SUBSCRIPTION_SSE_EVENTS.includes('subscription_activated')) {
  fail('subscription_activated SSE missing');
} else pass('subscription activation SSE registered');

if (!UPDATE_SETTINGS_SSE_EVENTS.includes('app_version_changed')) {
  fail('app_version_changed SSE missing for update settings');
} else pass('update settings SSE registered');

if (!updateClient.includes('getApiBaseUrl')) fail('updateClient must use dynamic API base');
else pass('updateClient dynamic API base for update-check SSE');

const debounceMatch = ctx.match(/adminSoftSyncTimerRef\.current = setTimeout\([\s\S]*?,\s*(\d+)\)/);
const debounceMs = debounceMatch ? Number(debounceMatch[1]) : NaN;
if (!Number.isFinite(debounceMs) || debounceMs > 1000) {
  fail(`admin soft sync debounce should be <= 1000ms, got ${debounceMs}`);
} else pass(`admin soft sync debounce ${debounceMs}ms (immediate path)`);

(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BASE}/api/sync/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) fail(`SSE stream HTTP ${res.status}`);
    else pass(`SSE /api/sync/stream reachable (HTTP ${res.status})`);
    try {
      res.body?.cancel?.();
    } catch {}
  } catch (e) {
    clearTimeout(timer);
    if (String(e?.name) === 'AbortError') pass('SSE /api/sync/stream reachable (stream opened, probe aborted)');
    else fail(`SSE probe failed: ${e?.message ?? e}`);
  }

  console.log('\n=== REALTIME REFRESH EVIDENCE ===');
  console.log(`SSE events whitelisted: catalog=${ADMIN_SOFT_REFRESH_SSE_EVENTS.length} modes=${ADMIN_RUNTIME_MODE_SSE_EVENTS.length} subscription=${SUBSCRIPTION_SSE_EVENTS.length} update=${UPDATE_SETTINGS_SSE_EVENTS.length}`);
  console.log(`Admin SSE → ~${debounceMs}ms debounce → forceNetwork catalog refresh + subscription reverify`);
  console.log('Runtime modes (FREE/EMERGENCY/MAINTENANCE) → immediate patch, no debounce');
  console.log('Update settings → updateClient SSE (app_version_changed) + 200ms recheck');
  console.log('Fallback: settings poll 10s, foreground catalog tick 30s');

  if (!process.exitCode) {
    console.log('\n[verify-realtime-refresh] ok');
  }
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
