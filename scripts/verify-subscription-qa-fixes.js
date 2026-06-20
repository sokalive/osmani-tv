#!/usr/bin/env node
'use strict';

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

const ctx = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'components', 'PremiumModal.js'), 'utf8');

if (!fs.existsSync(path.join(root, 'lib', 'subscriptionCacheHydrate.js'))) {
  fail('subscriptionCacheHydrate.js missing');
} else pass('subscription cache hydrate module');

if (!ctx.includes('hydrateSubscriptionFromCache')) fail('context hydrates subscription cache on boot');
else pass('boot subscription cache hydrate');

if (!app.includes('subscriptionSyncLoaded && !quickSnapshot.isSubscribed')) {
  fail('unpaid tap must wait for subscription sync');
} else pass('unpaid tap gated on subscriptionSyncLoaded');

if (!modal.includes('optimistic: true')) fail('PremiumModal optimistic payment success');
else pass('optimistic payment success on gateway SUCCESS');

if (!ctx.includes('immediate: true')) fail('catalog SSE immediate refresh');
else pass('immediate catalog SSE refresh');

console.log('\n[verify-subscription-qa-fixes] ok');
