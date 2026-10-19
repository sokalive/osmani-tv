#!/usr/bin/env node
'use strict';

/**
 * Admin → app freshness. No network and no device.
 * Run: node scripts/verify-admin-stale-data.js
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const root = path.join(__dirname, '..');
const requireCjs = createRequire(__filename);

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

const popup = read('components/PopupSettingsModal.js');
const whatsapp = read('components/WhatsAppFloatingButton.js');
const ctx = read('context/OsmaniAppContext.jsx');
const realtime = read('lib/realtimeSync.js');
const cache = read('lib/catalogCache.js');
const plans = read('lib/paymentPlansCache.js');

if (!popup.includes("subscribeRealtimeEvent('popup_settings_changed'")) fail('popup SSE listener missing');
else pass('popup listens for popup_settings_changed');

if (!popup.includes("subscribeRealtimeEvent('__sync_stream_connected'")) fail('popup reconnect refetch missing');
else pass('popup refetches after SSE reconnect');

if (!popup.includes("subscribeRealtimeEvent('snapshot'")) fail('popup snapshot refetch missing');
else pass('popup refetches after SSE snapshot');

if (!whatsapp.includes("subscribeRealtimeEvent('snapshot'")) fail('whatsapp snapshot refetch missing');
else pass('whatsapp refetches after SSE snapshot');

if (!whatsapp.includes("subscribeRealtimeEvent('__sync_stream_connected'")) fail('whatsapp reconnect refetch missing');
else pass('whatsapp refetches after SSE reconnect');

if (!ctx.includes("refreshPaymentPlansCache({ reason: 'sse:snapshot' })")) fail('snapshot must refresh plans');
else pass('snapshot refreshes plans');

if (!ctx.includes("refreshSettingsOnly('sse:snapshot')")) fail('snapshot must refresh app settings');
else pass('snapshot refreshes app settings');

if (!ctx.includes("refreshPaymentPlansCache({ reason: 'sse:sync_stream_connected' })")) {
  fail('reconnect must refresh plans');
} else pass('reconnect refreshes plans');

if (!ctx.includes("refreshPaymentPlansCache({ reason: 'app_resume' })")) fail('resume must refresh plans');
else pass('resume refreshes plans');

if (!ctx.includes('refreshFollowUpRef')) fail('forced catalog refresh must coalesce an in-flight request');
else pass('forced catalog refresh schedules one follow-up');

if (!plans.includes('plansEpoch')) fail('plans refresh must ignore an older in-flight write');
else pass('plans refresh ignores an older in-flight write');

if (!popup.includes('generationRef')) fail('popup generation guard missing');
else pass('popup ignores late responses');

if (!whatsapp.includes("subscribeRealtimeEvent('whatsapp_settings_changed'")) fail('whatsapp SSE listener missing');
else pass('whatsapp listens for whatsapp_settings_changed');

if (!ctx.includes('refreshGenRef')) fail('catalog refresh generation missing');
else pass('catalog refresh drops stale results');

if (!ctx.includes("'config.channels_changed'") && !read('lib/adminSseRefreshEvents.js').includes("'config.channels_changed'")) {
  fail('channel SSE name missing');
} else pass('channel change events are registered');

if (!read('lib/adminSseRefreshEvents.js').includes("'config.banners_changed'")) fail('banner SSE name missing');
else pass('banner change events are registered');

if (!cache.includes('slot.epoch')) fail('catalog cache epoch missing');
else pass('catalog cache rejects stale writes');

if (!plans.includes('pendingReason')) fail('plans refresh must follow an in-flight request');
else pass('plans refresh does not stay on the older in-flight response');

if (/configVersion\s*</.test(realtime) || realtime.includes('lastConfigVersion')) {
  fail('realtimeSync must not drop events because configVersion decreased');
} else pass('configVersion decrease is not treated as stale');

if (!realtime.includes('process-local')) fail('configVersion restart note missing');
else pass('configVersion restart behavior is documented');

let normalizePopupSettings;
let popupContentKey;
let shouldAcceptAdminConfigEvent;
let getCachedChannels;
let invalidateCatalogCache;
try {
  ({
    normalizePopupSettings,
    popupContentKey,
    shouldAcceptAdminConfigEvent,
  } = requireCjs('../lib/popupSettingsNormalize.js'));
  ({ getCachedChannels, invalidateCatalogCache } = requireCjs('../lib/catalogCache.js'));
} catch (e) {
  fail(`require helpers: ${e.message}`);
}

if (normalizePopupSettings) {
  const once = normalizePopupSettings({ mode: 'once', title: 'Habari' });
  const always = normalizePopupSettings({ mode: 'always', title: 'Live' });
  const stored = normalizePopupSettings({ mode: 'show_once', title: 'Habari' });
  if (once.mode !== 'show_once' || always.mode !== 'always_show' || stored.mode !== 'show_once') {
    fail(`popup mode aliases once=${once.mode} always=${always.mode} stored=${stored.mode}`);
  } else pass('public once/always modes map to popup modes');

  if (normalizePopupSettings({ mode: 'disabled' }).mode !== 'disabled') fail('disabled popup mode');
  else pass('disabled popup stays disabled');

  const a = popupContentKey({ title: 'A', greeting: '', bullet_points: [], disclaimer: '' });
  const b = popupContentKey({ title: 'B', greeting: '', bullet_points: [], disclaimer: '' });
  if (a === b) fail('popup content key must change when title changes');
  else pass('popup show-once key follows admin text');

  if (!shouldAcceptAdminConfigEvent(12838, 55)) fail('lower configVersion after restart must still be accepted');
  else pass('lower configVersion after restart is accepted');
}

async function catalogFollowUp() {
  invalidateCatalogCache();
  let calls = 0;
  const gates = [];
  const fetcher = () => {
    calls += 1;
    return new Promise((resolve) => {
      gates.push(resolve);
    });
  };
  const followFetcher = () => {
    calls += 1;
    return Promise.resolve([{ id: 'follow' }]);
  };
  const first = getCachedChannels(fetcher, { force: true });
  const second = getCachedChannels(followFetcher, { force: true });
  const third = getCachedChannels(followFetcher, { force: true });
  if (calls !== 1) {
    fail(`forced refresh reused or stormed the in-flight request (calls=${calls})`);
    return;
  }
  gates[0]([{ id: 'stale' }]);
  const [a, b, c] = await Promise.all([first, second, third]);
  const visible = await getCachedChannels(() => Promise.resolve([{ id: 'should-not-fetch' }]));
  if (calls !== 2) fail(`follow-up fetch count ${calls}, expected 2`);
  else if (a[0]?.id !== 'follow' || b[0]?.id !== 'follow' || c[0]?.id !== 'follow') {
    fail('forced follow-up did not replace the in-flight catalog');
  } else if (visible[0]?.id !== 'follow') fail('follow-up result was not stored');
  else pass('forced refresh waits for one follow-up and does not reuse stale in-flight data');
}

async function catalogRace() {
  invalidateCatalogCache();
  let releaseOld;
  const oldPromise = getCachedChannels(
    () =>
      new Promise((resolve) => {
        releaseOld = () => resolve([{ id: 'old' }]);
      }),
    { force: true },
  );
  invalidateCatalogCache();
  const fresh = await getCachedChannels(() => Promise.resolve([{ id: 'new' }]), { force: true });
  releaseOld();
  await oldPromise.catch(() => {});
  const visible = await getCachedChannels(() => Promise.resolve([{ id: 'should-not-fetch' }]));
  if (!Array.isArray(fresh) || fresh[0]?.id !== 'new') fail('fresh catalog fetch did not win');
  else if (!Array.isArray(visible) || visible[0]?.id !== 'new') fail('late catalog response overwrote newer data');
  else pass('late catalog response cannot overwrite newer channels');
}

catalogFollowUp()
  .then(() => catalogRace())
  .then(() => {
    if (process.exitCode) process.exit(process.exitCode);
    console.log('\n[verify-admin-stale-data] ok');
  })
  .catch((e) => {
    fail(e?.stack || e?.message || e);
    process.exit(1);
  });
