#!/usr/bin/env node
'use strict';

/**
 * Payment waiting UI + instant Lipia tap verification.
 * Run: node scripts/verify-payment-waiting-ui.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

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

const modal = read('components/PremiumModal.js');
const waiting = read('components/PaymentWaitingStep.js');

if (!waiting.includes('Inasubiri Uthibitisho wa Malipo')) fail('waiting title');
else pass('waiting title');

if (!waiting.includes('yanayoonekana kwenye simu yako')) fail('USSD/PIN popup wording');
else pass('USSD/PIN popup wording');

if (waiting.includes('Tumetuma ombi la malipo') || waiting.includes('ujumbe wa malipo uliotumwa')) {
  fail('must not refer to SMS/message sent');
} else pass('no SMS/message wording');

if (!waiting.includes('Thibitisha malipo kwa PIN yako')) fail('short Muhimu tip 1');
else pass('short Muhimu tip 1');

if (!waiting.includes('Usibonyeze GHAIRI kabla malipo hayajakamilika')) fail('short GHAIRI tip');
else pass('short GHAIRI tip');

if (waiting.includes('warningCard')) fail('long warning card removed');
else pass('long warning card removed');

if (!modal.includes('scrollEnabled={step !== 3}')) fail('step 3 scroll disabled');
else pass('step 3 scroll disabled');

if (!waiting.includes('Hatua za Malipo')) fail('progress steps card');
else pass('progress steps card');

if (!waiting.includes('Ombi Limetumwa')) fail('progress step 1 label');
else pass('progress step 1 label');

if (!modal.includes('PaymentWaitingStep')) fail('PremiumModal uses PaymentWaitingStep');
else pass('PremiumModal uses PaymentWaitingStep');

if (!modal.includes('identityPrefetchRef')) fail('identity prefetch ref');
else pass('identity prefetch ref');

if (!modal.includes('payInFlightRef')) fail('pay in-flight guard');
else pass('pay in-flight guard');

if (!modal.includes('paymentProgressStep')) fail('payment progress step state');
else pass('payment progress step state');

const payFn = modal.match(/const handleStep2Pay = async \(\) => \{[\s\S]*?\n  \};/);
if (!payFn) fail('handleStep2Pay block');
else {
  const body = payFn[0];
  if (body.includes('await reloadCheckoutConfig()')) {
    fail('handleStep2Pay must not await reloadCheckoutConfig on tap');
  } else pass('no checkout config refetch on Lipia tap');
  if (!body.includes('if (submitting || payInFlightRef.current) return')) {
    fail('double-tap guard missing');
  } else pass('double-tap guard in pay handler');
}

if (!modal.includes('setPaymentProgressStep(2)')) fail('progress advances on payment success poll');
else pass('progress advances on payment success poll');

if (process.exitCode) {
  process.exit(1);
}
console.log('\n[verify-payment-waiting-ui] ok');
