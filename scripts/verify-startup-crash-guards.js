#!/usr/bin/env node
'use strict';

/**
 * Static checks: startup crash guards after OTA payment/subscription fixes.
 * Run: node scripts/verify-startup-crash-guards.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const context = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const updateClient = fs.readFileSync(path.join(root, 'lib', 'updateClient.js'), 'utf8');
const payment = fs.readFileSync(path.join(root, 'api', 'payment.js'), 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (context.includes("import { warmPaymentCatalogCache } from '../api/payment'")) {
  fail('context must not eagerly import api/payment at module load');
} else pass('lazy payment warm import');

if (!context.includes('safeStartupRun')) fail('context uses safeStartupRun');
else pass('context safeStartupRun');

if (!context.includes('await import(\'../api/payment\')')) {
  fail('payment warm must dynamic import');
} else pass('dynamic import payment warm');

if (!app.includes('StartupErrorBoundary')) fail('App needs StartupErrorBoundary');
else pass('StartupErrorBoundary mounted');

if (!app.includes('safeStartupRun(\'start-update-client\'')) {
  fail('startUpdateClient must be guarded');
} else pass('guarded startUpdateClient');

if (!updateClient.includes('reassert_failed')) fail('update resume reassert guarded');
else pass('guarded update resume reassert');

if (!updateClient.includes('start_failed')) fail('startUpdateClient guarded');
else pass('guarded update client start');

if (!payment.includes('[payment-catalog-warm]')) fail('warmPaymentCatalogCache guarded');
else pass('guarded payment catalog warm');

if (!process.exitCode) {
  console.log('\n[verify-startup-crash-guards] ok');
}
