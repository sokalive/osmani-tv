#!/usr/bin/env node
'use strict';

/**
 * Account subscription stat cards — package label, duration, remaining anchor.
 * Run: node scripts/verify-account-subscription-cards.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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

const account = read('screens/AkauntiYanguScreen.js');
const display = read('lib/accountSubscriptionDisplay.js');
const math = read('lib/subscriptionMath.js');
const merge = read('lib/subscriptionDetailsMerge.js');
const context = read('context/OsmaniAppContext.jsx');

if (!account.includes('formatAccountPackageLabel')) fail('Account uses formatAccountPackageLabel');
else pass('Account uses formatAccountPackageLabel');

if (!account.includes('getBackendAnchoredRemainingMs')) fail('Account uses backend remaining anchor');
else pass('Account uses backend remaining anchor');

if (!account.includes('lastDurationDaysRef')) fail('duration sticky ref required');
else pass('duration sticky ref');

if (!display.includes('enrichSubscriptionDetailsForDisplay')) fail('display enrich helper');
else pass('display enrich helper');

if (!math.includes('getBackendAnchoredRemainingMs')) fail('subscriptionMath backend anchor');
else pass('subscriptionMath backend anchor');

if (!merge.includes('displayDurationDays')) fail('merge sticky displayDurationDays');
else pass('merge sticky displayDurationDays');

if (!context.includes('enrichSubscriptionDetailsForDisplay')) fail('context enriches verify details');
else pass('context enriches verify details');

if (!account.includes('lastPackageLabelRef')) fail('payment card sticky ref during sparse refresh');
else pass('payment card sticky ref during sparse refresh');

if (!display.includes('findCatalogPlanForDetails')) fail('catalog plan lookup');
else pass('catalog plan lookup');

if (!process.exitCode) {
  console.log('\n[verify-account-subscription-cards] ok');
}
