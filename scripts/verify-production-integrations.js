#!/usr/bin/env node
'use strict';

/**
 * Static integration audit for production features (OTA/runtime paths).
 * Run: node scripts/verify-production-integrations.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertContains(rel, needle, label) {
  const text = read(rel);
  if (!text.includes(needle)) {
    console.error('FAIL:', label, rel, 'missing', needle);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

function assertNotContains(rel, needle, label) {
  const text = read(rel);
  if (text.includes(needle)) {
    console.error('FAIL:', label, rel, 'still contains', needle);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

assertContains('App.js', 'GlobalPaymentModalGate', 'payment modal gate mounted');
assertContains('App.js', 'UpdateOverlay', 'update overlay mounted');
assertContains('App.js', 'startUpdateClient', 'update client started');
assertContains('App.js', 'startExpoUpdatesClient', 'expo updates client started');
assertContains('screens/ChannelPlayerScreen.js', 'TrialWatchOverlay', 'trial overlay on player');
assertContains('screens/ChannelPlayerScreen.js', 'User-intent only', 'trial expiry does not auto-open payment');
assertContains('App.js', 'openPremiumModalFromExplicitTap', 'direct premium modal from explicit tap');
assertContains('lib/premiumAccessIntent.js', 'grantPremiumAccessIntent', 'premium tap intent module');
assertNotContains('App.js', 'PremiumAccessPromptModal', 'no intermediate premium prompt');
assertContains('lib/normalizeBanner.js', 'enrichBannerForViewer', 'banner serializer in normalize path');
assertContains('api.js', 'enrichBannersForViewer', 'banner serializer on API fetch');
assertContains('context/OsmaniAppContext.jsx', 'tryGetViewerTrialWatchSettings', 'trial settings fetch');
assertContains('context/OsmaniAppContext.jsx', 'refreshTrialWatchSettings', 'trial settings refresh');
assertContains('lib/updateClient.js', 'isApkUpdateCheckEnabled', 'update checks split from sideload');
assertContains('lib/updateClient.js', 'performJsOnlyUpdateCheck', 'JS update-check fallback');
assertContains('components/GlobalPaymentModalGate.js', 'useRegisterBlockingSheet', 'payment modal coordinator');
assertContains('app.config.js', 'expo-updates', 'expo updates plugin');
assertContains('app.config.js', "policy: 'appVersion'", 'runtime version policy');

if (process.exitCode) {
  process.exit(1);
}
console.log('[verify-production-integrations] ok');
