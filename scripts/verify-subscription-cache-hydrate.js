#!/usr/bin/env node
'use strict';

/**
 * Static checks: subscription cache-first UX and update popup v15–v23 resume.
 * Run: node scripts/verify-subscription-cache-hydrate.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const context = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const updateClient = fs.readFileSync(path.join(root, 'lib', 'updateClient.js'), 'utf8');
const hydrate = fs.readFileSync(path.join(root, 'lib', 'subscriptionCacheHydrate.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'screens', 'ChannelPlayerScreen.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (!hydrate.includes('readHydratableSubscriptionCache')) {
  fail('subscription cache hydrate helper required');
} else pass('cache hydrate helper present');

if (hydrate.includes('shouldHydrateSubscriptionCache')) {
  fail('hydrate must not skip same-device active cache at boot');
} else pass('hydrate trusts same-device active cache');

if (!context.includes('shouldHydrateSubscriptionCache')) {
  fail('context must reject stale cache on hydrate');
} else pass('context stale cache guard');

if (!context.includes('hydrateSubscriptionFromCache')) {
  fail('cold-start cache hydration required');
} else pass('cold-start cache hydration');

if (context.includes('provider-eager-hydrate') || context.includes('authoritativeInactiveRef')) {
  pass('bootstrap entitlement hydrate before premium gate');
} else if (!context.includes('allowed_cache_ref')) {
  fail('gateForPlayback cache fast path required');
} else pass('gateForPlayback cache fast path');

if (!context.includes("r.resolveSource !== 'inactive'")) {
  fail('must preserve subscription until server confirms inactive');
} else pass('inactive-only revoke policy');

if (!updateClient.includes('installed >= PUBLISHED_PLAY_VERSION_CODE')) {
  fail('v24+ update suppression required');
} else pass('v24+ update suppression');

if (!updateClient.includes('softUpdateDismissed = false')) {
  fail('resume must reset dismiss for v15–v23');
} else pass('resume dismiss reset');

if (updateClient.includes('PLAY_OTA_MIN_VERSION_CODE - 1')) {
  fail('v15-only resume reassert must be expanded to v15–v23');
} else pass('v15-only guard removed');

if (!context.includes('awaitRecoverBoot')) {
  fail('awaitRecoverBoot required for v24 migration boot');
} else pass('awaitRecoverBoot export');

if (!context.includes('RECOVER_BOOT_TIMEOUT_MS')) {
  fail('fast recover boot timeout required');
} else pass('recover boot timeout');

if (!context.includes('hadActiveBefore')) {
  fail('transfer/revoke modals must require prior active subscription');
} else pass('false transfer guard');

const fetch = fs.readFileSync(path.join(root, 'lib', 'catalogApiFetch.js'), 'utf8');
if (!fetch.includes('ADMIN_API_TIMEOUT_MS')) {
  fail('admin API fetch timeout required');
} else pass('admin API fetch timeout');

const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
if (!app.includes('awaitPremiumSnapshotCapped')) {
  fail('channel tap must use capped premium snapshot gate');
} else pass('capped channel tap snapshot gate');

if (!player.includes('isSubscribed')) {
  fail('player optimistic premium gate required');
} else pass('player optimistic premium gate');

if (!hydrate.includes('subscriptionDetailsFromPlanSnapshot')) {
  fail('plan snapshot hydrate required');
} else pass('plan snapshot hydrate');

const merge = fs.readFileSync(path.join(root, 'lib', 'subscriptionDetailsMerge.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'screens', 'AkauntiYanguScreen.js'), 'utf8');
const subApi = fs.readFileSync(path.join(root, 'api', 'subscription.js'), 'utf8');

if (!merge.includes('mergeSubscriptionDetails')) fail('mergeSubscriptionDetails required');
else pass('mergeSubscriptionDetails module');

if (!context.includes('mergeSubscriptionDetails')) fail('context must merge partial verify details');
else pass('context merges partial verify details');

if (!subApi.includes('planSnapshot')) fail('subscription cache must persist plan snapshot');
else pass('plan snapshot AsyncStorage key');

if (!account.includes('lastPackageLabelRef')) fail('account sticky package label ref');
else pass('account sticky package label ref');

if (!account.includes('lastDurationDaysRef')) fail('account sticky duration ref required');
else pass('account sticky duration ref');

const { mergeSubscriptionDetails } = require('../lib/subscriptionDetailsMerge');
const merged = mergeSubscriptionDetails(
  { amount: 5000, currency: 'TZS', planDurationDays: 30, plans: [{ id: 1, price: 5000 }] },
  { amount: null, planDurationDays: null, plans: [], expiresAt: '2026-12-01', active: true },
);
if (merged.amount !== 5000) fail('merge must preserve amount');
else pass('merge preserves amount');
if (merged.planDurationDays !== 30) fail('merge must preserve planDurationDays');
else pass('merge preserves planDurationDays');
if (!Array.isArray(merged.plans) || merged.plans.length !== 1) fail('merge must preserve plans');
else pass('merge preserves plans');

if (!process.exitCode) {
  console.log('\n[verify-subscription-cache-hydrate] ok');
}
