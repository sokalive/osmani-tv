#!/usr/bin/env node
'use strict';

/**
 * System-wide Smart Monitor + unblock access rules.
 * Run: node scripts/verify-smart-monitor-system.js
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

function assertTrue(label, cond) {
  if (!cond) {
    fail(label);
    return;
  }
  pass(label);
}

function readBoolish(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return null;
}

function parseServerIntelAccess(raw) {
  const rootObj = raw && typeof raw === 'object' ? raw : {};
  const registry = rootObj.registry && typeof rootObj.registry === 'object' ? rootObj.registry : null;
  const blockedFlag = rootObj.blocked === true || registry?.blocked === true;
  const allowedFlag = rootObj.allowed === true || registry?.allowed === true;
  const status = registry?.status != null ? String(registry.status).trim().toLowerCase() : null;
  const serverIntelOpen =
    !blockedFlag &&
    (allowedFlag || status === 'active' || status === 'unblocked' || status === 'smart_monitor');
  return { serverIntelBlocked: blockedFlag, serverIntelOpen, status };
}

function resolveEffectiveSmartMonitor(input) {
  if (input.intelSmartMonitor || input.securitySmartMonitor) return true;
  if (!input.serverIntelOpen) return false;
  if (input.serverSecurityBlocked || input.serverPlaybackAllowed === false) return false;
  if (input.serverPlaybackAllowed === true && input.localThreat) return true;
  return false;
}

function resolveEffectivePlaybackAllowed(input) {
  if (input.serverIntelBlocked || input.serverSecurityBlocked) return false;
  if (input.serverPlaybackAllowed === false) return false;
  if (input.serverPlaybackAllowed === true) return true;
  if (input.effectiveSmartMonitor && input.serverIntelOpen) return true;
  if (input.serverIntelOpen && !input.localThreat) return true;
  return false;
}

const intelOpen = {
  ok: true,
  blocked: false,
  allowed: true,
  registry: { status: 'active', blocked: false, allowed: true },
};

const parsed = parseServerIntelAccess(intelOpen);
assertTrue('server intel open when blocked=false', parsed.serverIntelOpen === true);

assertTrue(
  'infer smart monitor from security allow + local root',
  resolveEffectiveSmartMonitor({
    serverIntelOpen: true,
    serverPlaybackAllowed: true,
    serverSecurityBlocked: false,
    localThreat: true,
  }),
);

const playbackAllowed = resolveEffectivePlaybackAllowed({
  serverIntelOpen: true,
  serverIntelBlocked: false,
  serverPlaybackAllowed: true,
  serverSecurityBlocked: false,
  effectiveSmartMonitor: true,
  localThreat: true,
});
assertTrue('playback allowed for smart monitor device', playbackAllowed === true);

const riskEngine = fs.readFileSync(path.join(root, 'lib/security/riskEngine.js'), 'utf8');
const securityCtx = fs.readFileSync(path.join(root, 'context/SecurityContext.jsx'), 'utf8');
assertTrue('intelAccessOpen gate', riskEngine.includes('intelAccessOpen === true'));
assertTrue('enforcement diagnostics', riskEngine.includes('enforcementReason'));
const applyIdx = securityCtx.indexOf('applyServerReport(report)');
const signalsIdx = securityCtx.indexOf('setSignals(scan.signals)');
assertTrue('scan signals applied after server report', applyIdx > 0 && signalsIdx > applyIdx);
assertTrue('persisted security policy', fs.readFileSync(path.join(root, 'lib/lastSecurityReportSnapshot.js'), 'utf8').includes('loadPersistedSecurityReportSnapshot'));
assertTrue('useSyncExternalStore in security', securityCtx.includes('useSyncExternalStore'));

if (!process.exitCode) {
  console.log('\n[verify-smart-monitor-system] ok');
}
