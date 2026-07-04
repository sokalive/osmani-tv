#!/usr/bin/env node
'use strict';

/**
 * OMBA KIFURUSHI CHAKO + payment recovery wiring verification.
 * Run: node scripts/verify-omba-kifurushi.js
 */

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

const admin = fs.readFileSync(path.join(root, 'lib/adminSseRefreshEvents.js'), 'utf8');
const ctx = fs.readFileSync(path.join(root, 'context/OsmaniAppContext.jsx'), 'utf8');
const account = fs.readFileSync(path.join(root, 'screens/AkauntiYanguScreen.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/subscriptionRequest.js'), 'utf8');
const payment = fs.readFileSync(path.join(root, 'api/payment.js'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'components/OmbaKifurushiModal.js'), 'utf8');
const section = fs.readFileSync(path.join(root, 'components/OmbaKifurushiSection.js'), 'utf8');
const contract = JSON.parse(
  fs.readFileSync(path.join(root, 'payment-recovery-subscription-request-contract.json'), 'utf8'),
);

const requiredSse = ['subscription_request_updated', 'omba_kifurushi_settings_changed'];
for (const ev of requiredSse) {
  if (!admin.includes(`'${ev}'`)) fail(`missing SSE event ${ev}`);
  else pass(`SSE event registered: ${ev}`);
}

if (!account.includes('OmbaKifurushiSection')) fail('Account screen must render OmbaKifurushiSection');
else pass('Account screen wires OmbaKifurushiSection');

if (!account.includes('identity.deviceId')) fail('Account must show canonical deviceId');
else pass('Account uses canonical deviceId');

if (!api.includes('/api/subscription-request')) fail('subscriptionRequest API module');
else pass('subscriptionRequest API module');

if (!api.includes('identity.deviceId')) fail('submit must use identity.deviceId');
else pass('submit uses identity.deviceId');

if (!modal.includes('TUMA OMBI KWA ADMIN')) fail('modal submit button text');
else pass('modal submit button text');

if (!modal.includes('Ombi lako limetumwa kwa Admin')) fail('success confirmation Swahili');
else pass('success confirmation Swahili');

if (!section.includes('OMBA KIFURUSHI CHAKO')) fail('section button text');
else pass('section button text');

const correlationFields = contract.system_a_payment_orders.app_create_order_correlation_fields;
for (const field of correlationFields) {
  if (!payment.includes(field)) fail(`payment.js missing correlation field ${field}`);
  else pass(`payment correlation field: ${field}`);
}

if (!ctx.includes('SUBSCRIPTION_WAKE_SSE_EVENTS')) fail('context wake listeners');
else pass('context SUBSCRIPTION_WAKE_SSE_EVENTS listeners');

if (contract.system_b_subscription_requests.disabled_message_sw !==
    'Huduma hii imezuiliwa na Admin kwa sasa. Wasiliana na muhudumu kwa msaada zaidi.') {
  fail('disabled message contract mismatch');
} else pass('disabled message contract');

console.log('\nverify-omba-kifurushi:', process.exitCode ? 'FAIL' : 'PASS');
