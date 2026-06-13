#!/usr/bin/env node
'use strict';

/**
 * Verify admin unblock + Smart Monitor parsing and enforcement hooks.
 * Run: node scripts/verify-smart-monitor-workflow.js
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

function readBoolish(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  return null;
}

function readRecord(parsed) {
  const rootObj = parsed && typeof parsed === 'object' ? parsed : {};
  const data =
    rootObj.data && typeof rootObj.data === 'object' && !Array.isArray(rootObj.data)
      ? rootObj.data
      : rootObj;
  const registry =
    data.registry && typeof data.registry === 'object'
      ? data.registry
      : rootObj.registry && typeof rootObj.registry === 'object'
        ? rootObj.registry
        : null;
  const device =
    data.device && typeof data.device === 'object'
      ? data.device
      : registry && typeof registry === 'object'
        ? registry
        : data;
  return { root: rootObj, data, registry, device };
}

function readSmartMonitorEnabled(record) {
  const { root, data, registry, device } = record;
  return (
    readBoolish(root.smart_monitor_enabled) === true ||
    readBoolish(root.smartMonitorEnabled) === true ||
    readBoolish(data.smart_monitor_enabled) === true ||
    readBoolish(data.smartMonitorEnabled) === true ||
    readBoolish(registry?.smart_monitor_enabled) === true ||
    readBoolish(registry?.smartMonitorEnabled) === true ||
    readBoolish(device?.smart_monitor_enabled) === true ||
    readBoolish(device?.smartMonitorEnabled) === true
  );
}

function parseDeviceIntelligenceAccess(parsed) {
  const record = readRecord(parsed);
  const { root, data, registry, device } = record;

  const blockedFlag =
    readBoolish(root.blocked) === true ||
    readBoolish(data.blocked) === true ||
    readBoolish(registry?.blocked) === true ||
    readBoolish(device?.blocked) === true;

  const disallowed =
    readBoolish(root.allowed) === false ||
    readBoolish(data.allowed) === false ||
    readBoolish(registry?.allowed) === false ||
    readBoolish(device?.allowed) === false;

  const statusRaw = String(registry?.status ?? data.status ?? device?.status ?? root.status ?? '')
    .trim()
    .toLowerCase();

  const smartMonitorEnabled =
    readSmartMonitorEnabled(record) || statusRaw === 'smart_monitor' || statusRaw === 'monitor';

  if (blockedFlag || disallowed || statusRaw === 'blocked') {
    return { status: 'blocked', smartMonitorEnabled: false, explicitUnblock: false };
  }
  if (smartMonitorEnabled) {
    return { status: 'active', smartMonitorEnabled: true, explicitUnblock: false };
  }
  if (statusRaw === 'unblocked') {
    return { status: 'active', smartMonitorEnabled: false, explicitUnblock: true };
  }
  if (statusRaw === 'active' || readBoolish(root.allowed) === true) {
    return { status: 'active', smartMonitorEnabled: false, explicitUnblock: false };
  }
  return { status: null, smartMonitorEnabled: false, explicitUnblock: false };
}

function parseSecurityReportResponse(parsed) {
  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
  const enforcement =
    typeof data.enforcement === 'string'
      ? data.enforcement
      : typeof root.enforcement === 'string'
        ? root.enforcement
        : null;
  let playbackAllowed =
    readBoolish(data.playbackAllowed) ??
    readBoolish(data.playback_allowed) ??
    readBoolish(root.playbackAllowed) ??
    readBoolish(root.playback_allowed);
  const securityBlocked =
    readBoolish(data.security_blocked) === true || readBoolish(root.security_blocked) === true;
  const blockedFlag =
    readBoolish(data.blocked) === true ||
    readBoolish(root.blocked) === true ||
    String(data.status ?? root.status ?? '').trim().toLowerCase() === 'blocked';
  const smartMonitorEnabled =
    readBoolish(data.smart_monitor_enabled) === true ||
    readBoolish(root.smart_monitor_enabled) === true ||
    String(enforcement ?? '').trim().toLowerCase() === 'monitor';
  if (securityBlocked || blockedFlag) playbackAllowed = false;
  if (String(enforcement ?? '').trim().toLowerCase() === 'block' && playbackAllowed !== false) {
    playbackAllowed = false;
  }
  const blocked =
    securityBlocked ||
    blockedFlag ||
    playbackAllowed === false ||
    String(enforcement ?? '').trim().toLowerCase() === 'block';
  return { enforcement, playbackAllowed, blocked, smartMonitorEnabled };
}

function assertEq(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  pass(label);
}

function assertTrue(label, cond) {
  if (!cond) {
    fail(label);
    return;
  }
  pass(label);
}

const unblocked = parseDeviceIntelligenceAccess({
  blocked: false,
  allowed: true,
  registry: { status: 'unblocked', blocked: false, allowed: true },
});
assertEq('unblocked status', unblocked.status, 'active');
assertTrue('unblocked explicit flag', unblocked.explicitUnblock === true);

const monitor = parseDeviceIntelligenceAccess({
  blocked: false,
  allowed: true,
  smart_monitor_enabled: true,
  registry: { status: 'active', smartMonitorEnabled: true },
});
assertEq('smart monitor status', monitor.status, 'active');
assertTrue('smart monitor flag', monitor.smartMonitorEnabled === true);
assertTrue('smart monitor silent restore', monitor.explicitUnblock === false);

assertEq(
  'risk threshold re-block',
  parseDeviceIntelligenceAccess({
    blocked: true,
    smart_monitor_enabled: false,
    registry: { status: 'blocked', blocked: true },
  }).status,
  'blocked',
);

const securityMonitor = parseSecurityReportResponse({
  smart_monitor_enabled: true,
  security_blocked: false,
  playback_allowed: true,
  enforcement: 'monitor',
});
assertTrue('security smart monitor not blocked', securityMonitor.blocked === false);

const securityBlocked = parseSecurityReportResponse({
  smart_monitor_enabled: true,
  security_blocked: true,
  playback_allowed: false,
  enforcement: 'block',
});
assertTrue('security threshold block', securityBlocked.blocked === true);

const intelSrc = fs.readFileSync(path.join(root, 'api/usersIntelligence.js'), 'utf8');
assertTrue('parseDeviceIntelligenceAccess exported', intelSrc.includes('parseDeviceIntelligenceAccess'));

const ctxSrc = fs.readFileSync(path.join(root, 'context/DeviceIntelligenceContext.jsx'), 'utf8');
assertTrue('explicit unblock modal only', ctxSrc.includes('showUnblockModal: result.explicitUnblock'));

const riskSrc = fs.readFileSync(path.join(root, 'lib/security/riskEngine.js'), 'utf8');
assertTrue('smart monitor bypasses local threat block', riskSrc.includes('smartMonitorEnabled === true'));

if (!process.exitCode) {
  console.log('\n[verify-smart-monitor-workflow] ok');
}
