#!/usr/bin/env node
'use strict';

/**
 * Static checks: startup must paint Home immediately (no black frame).
 * Run: node scripts/verify-startup-paint.js
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

const app = read('App.js');
const policy = read('lib/otaBootGatePolicy.js');
const gate = read('components/EmbeddedOtaBootGate.js');
const splash = read('hooks/useStartupSplash.js');
const defer = read('lib/deferStartupTask.js');
const context = read('context/OsmaniAppContext.jsx');
const deferred = read('components/DeferredMount.js');

if (!app.includes('StartupInstantShell')) fail('App shows StartupInstantShell before nav ready');
else pass('instant startup shell');

if (!app.includes('hideStartupSplashWhenReady')) fail('splash hides on navigation ready');
else pass('splash tied to navigation ready');

if (!app.includes('startupShellOverlay')) fail('startup shell overlay');
else pass('startup shell overlay');

if (!policy.includes('isRunningDownloadedOtaBundle')) fail('OTA bundle skip policy');
else pass('skip OTA gate when downloaded bundle active');

if (!gate.includes('OTA_GATE_MAX_BLOCK_MS')) fail('embedded gate max timeout');
else pass('embedded gate max timeout');

if (splash.includes('requestAnimationFrame') && splash.includes('STARTUP_SPLASH_MIN_MS')) {
  fail('useStartupSplash must not hide splash on rAF/min timer');
} else pass('no early splash hide');

if (/import\s*\{[^}]*InteractionManager/.test(defer)) {
  fail('deferStartupTask must not use InteractionManager');
} else pass('defer uses rAF/setTimeout');

if (/import\s*\{[^}]*InteractionManager/.test(deferred)) {
  fail('DeferredMount must not use InteractionManager');
} else pass('DeferredMount uses setTimeout');

if (!context.includes('deferStartupTask(\'catalog-cache-hydrate\'')) {
  pass('catalog cache hydrate is immediate (not deferred)');
} else {
  fail('catalog cache hydrate must be immediate for first paint');
}

if (!read('lib/startupPaintDiagnostics.js').includes('[startup-paint]')) {
  fail('startup paint diagnostics');
} else pass('startup paint diagnostics');

if (!process.exitCode) {
  console.log('\n[verify-startup-paint] ok');
}
