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

catalogRace()
  .then(() => {
    if (process.exitCode) process.exit(process.exitCode);
    console.log('\n[verify-admin-stale-data] ok');
  })
  .catch((e) => {
    fail(e?.stack || e?.message || e);
    process.exit(1);
  });
