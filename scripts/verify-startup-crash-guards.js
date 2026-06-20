#!/usr/bin/env node
'use strict';

/**
 * Static checks: startup must never block Home or show failure screen.
 * Run: node scripts/verify-startup-crash-guards.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const context = fs.readFileSync(path.join(root, 'context', 'OsmaniAppContext.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const updateClient = fs.readFileSync(path.join(root, 'lib', 'updateClient.js'), 'utf8');
const payment = fs.readFileSync(path.join(root, 'api', 'payment.js'), 'utf8');
const boundary = fs.readFileSync(path.join(root, 'components', 'StartupErrorBoundary.js'), 'utf8');

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

if (!context.includes('deferStartupTask')) fail('context uses deferStartupTask');
else pass('context deferStartupTask');

if (!context.includes('await import(\'../api/payment\')')) {
  fail('payment warm must dynamic import');
} else pass('dynamic import payment warm');

if (!context.includes('deferStartupTask(\'catalog-cache-hydrate\'')) {
  fail('catalog cache hydrate must be deferred');
} else pass('deferred catalog cache hydrate');

if (!context.includes('deferStartupTask(\'subscription-cache-hydrate\'')) {
  fail('subscription hydrate must be deferred');
} else pass('deferred subscription hydrate');

if (!app.includes('StartupErrorBoundary')) fail('App needs StartupErrorBoundary');
else pass('StartupErrorBoundary mounted');

if (!app.includes('deferStartupTask(\'update-client\'')) {
  fail('startUpdateClient must be deferred');
} else pass('deferred startUpdateClient');

if (!app.includes('DeferredMount')) fail('heavy gates must use DeferredMount');
else pass('DeferredMount for overlay gates');

if (boundary.includes('Programu imeshindwa kuanza')) {
  fail('StartupErrorBoundary must not show blocking startup screen');
} else pass('no blocking startup screen');

if (!boundary.includes('[startup-boundary]')) fail('boundary must log render errors');
else pass('boundary logs render errors');

if (!updateClient.includes('reassert_failed')) fail('update resume reassert guarded');
else pass('guarded update resume reassert');

if (!updateClient.includes('start_failed')) fail('startUpdateClient guarded');
else pass('guarded update client start');

if (!payment.includes('[payment-catalog-warm]')) fail('warmPaymentCatalogCache guarded');
else pass('guarded payment catalog warm');

if (!process.exitCode) {
  console.log('\n[verify-startup-crash-guards] ok');
}
