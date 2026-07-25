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
const premium = read('components/PremiumModal.js');
const math = read('lib/subscriptionMath.js');
const merge = read('lib/subscriptionDetailsMerge.js');
const context = read('context/OsmaniAppContext.jsx');

if (!account.includes('formatAccountPackageLabel')) fail('Account uses formatAccountPackageLabel');
else pass('Account uses formatAccountPackageLabel');

if (!account.includes('resolveAccountRemainingDays')) fail('Account uses bounded real remaining days');
else pass('Account uses bounded real remaining days');

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

if (!account.includes('buildAccountDisplayDetails')) fail('Account uses buildAccountDisplayDetails');
else pass('Account uses buildAccountDisplayDetails');

if (!display.includes('mergeCheckoutPlanIntoSubscription')) fail('checkout plan merge helper');
else pass('checkout plan merge helper');

if (!premium.includes('mergeCheckoutPlanIntoSubscription')) fail('PremiumModal merges checkout plan on success');
else pass('PremiumModal instant checkout merge');

if (!premium.includes('unlockChannels(forUnlock)')) fail('PremiumModal unlockChannels on success');
else pass('PremiumModal unlockChannels');

const finalizeStart = premium.indexOf('const finalizePaymentSuccess');
const finalizeEnd = premium.indexOf('const handleOpenChannel', finalizeStart);
const finalizeBody = finalizeStart >= 0 ? premium.slice(finalizeStart, finalizeEnd) : '';
const instantUnlock =
  finalizeBody.includes('unlockChannels(forUnlock)') &&
  finalizeBody.includes('setStep(4)') &&
  finalizeBody.indexOf('unlockChannels(forUnlock)') < finalizeBody.indexOf('setStep(4)');
if (!instantUnlock) fail('finalizePaymentSuccess must unlock before success UI');
else pass('payment unlock before success UI');

if (!process.exitCode) {
  console.log('\n[verify-account-subscription-cards] ok');
}
