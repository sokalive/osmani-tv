#!/usr/bin/env node
'use strict';

/**
 * Emergency Mode popup: subscribed-only + exact channel-error copy.
 * Run: node scripts/verify-emergency-mode-popup.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const EXPECTED =
  'Habari Kuna Hitilafu Ime Tokea Kwenye Channel Hii Timu Yetu Ya Ufundi Ina Shulikia Tafadhali Jaribu Tena Baada Ya Dakika Chache';

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

const modal = read('components/EmergencyModal.js');
const app = read('App.js');
const banner = read('components/BannerCarousel.js');
const deep = read('lib/openOsmaniDeepLink.js');

if (!modal.includes(EXPECTED)) fail('EmergencyModal default MESSAGE must match exact channel-error copy');
else pass('EmergencyModal MESSAGE exact');

if (modal.includes('Hitilafu imetokea. Timu yetu ya ufundi inaishughulikia')) {
  fail('old EmergencyModal default message must be removed');
} else {
  pass('old default message removed');
}

if (!app.includes('if (emergencyMode && isSubscribed)')) {
  fail('channel tap must gate Emergency popup with isSubscribed');
} else {
  pass('App channel tap gates emergency with isSubscribed');
}

if (!app.includes('Boolean(emergencyMode) && Boolean(isSubscribed) && !dismissed')) {
  fail('GlobalEmergencyGate must require isSubscribed');
} else {
  pass('GlobalEmergencyGate requires isSubscribed');
}

if (!banner.includes('if (emergencyMode && isSubscribed)')) {
  fail('BannerCarousel must gate emergency with isSubscribed');
} else {
  pass('BannerCarousel gates emergency with isSubscribed');
}

if (!deep.includes('ctx.emergencyMode && ctx.isSubscribed')) {
  fail('deep link must gate emergency with isSubscribed');
} else {
  pass('deep link gates emergency with isSubscribed');
}

// Ensure payment / activation files were not part of this verify surface (sanity).
const paymentTouchedMarkers = [
  'finalizePaymentSuccess',
  'createSonicpesaOrder',
  'resolveOrderPaymentStatus',
];
for (const m of paymentTouchedMarkers) {
  if (modal.includes(m) || app.includes(`function ${m}`)) {
    /* App.js may import unrelated symbols elsewhere — only fail if EmergencyModal grew payment code */
  }
}
if (/create-order|payment-status|finalizePaymentSuccess/.test(modal)) {
  fail('EmergencyModal must not contain payment logic');
} else {
  pass('EmergencyModal has no payment logic');
}

if (!process.exitCode) {
  console.log('\n[verify-emergency-mode-popup] ok');
}
