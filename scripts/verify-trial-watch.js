#!/usr/bin/env node
'use strict';

/**
 * Smoke checks for non-premium trial / preview logic (no device required).
 * Run: node scripts/verify-trial-watch.js
 */

const assert = require('assert');

function pickDefined(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function coerceBool(v, fallback) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(t)) return false;
  }
  if (v == null) return fallback;
  return Boolean(v);
}

function coercePositiveInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

const FAIL_CLOSED = {
  enableTrial: false,
  trialMinutes: 0,
  previewSeconds: 0,
  enablePreviewAfterTrial: false,
  configLoaded: false,
};

function parseTrialWatchSettings(payload) {
  const out = { ...FAIL_CLOSED };
  const candidates = [payload];
  if (payload && typeof payload === 'object') {
    candidates.push(payload.payload, payload.data, payload.settings, payload.trial_watch);
  }
  for (const o of candidates) {
    if (!o || typeof o !== 'object') continue;
    const enableTrial = pickDefined(o, [
      'enable_trial',
      'enableTrial',
      'trial_enabled',
      'trialEnabled',
      'trial_watch_enabled',
      'trialWatchEnabled',
    ]);
    if (enableTrial !== undefined) {
      out.enableTrial = coerceBool(enableTrial, false);
      out.configLoaded = true;
    }
    const trialMinutes = pickDefined(o, [
      'trial_minutes',
      'trialMinutes',
      'trial_watch_minutes',
      'trialWatchMinutes',
    ]);
    if (trialMinutes !== undefined) {
      out.trialMinutes = coercePositiveInt(trialMinutes, 5);
    }
    const previewSeconds = pickDefined(o, [
      'preview_seconds',
      'previewSeconds',
      'trial_preview_seconds',
      'trialPreviewSeconds',
    ]);
    if (previewSeconds !== undefined) {
      out.previewSeconds = coercePositiveInt(previewSeconds, 11);
    }
    const enablePreview = pickDefined(o, [
      'enable_preview_after_trial',
      'enablePreviewAfterTrial',
      'trial_preview_after_enabled',
      'trialPreviewAfterEnabled',
    ]);
    if (enablePreview !== undefined) {
      out.enablePreviewAfterTrial = coerceBool(enablePreview, false);
      out.configLoaded = true;
    }
  }
  if (out.configLoaded) {
    if (out.enableTrial && out.trialMinutes <= 0) out.trialMinutes = 5;
    if (out.enablePreviewAfterTrial && out.previewSeconds <= 0) out.previewSeconds = 11;
  }
  return out;
}

function shouldApplyTrialWatch(input) {
  if (input?.freeMode) return false;
  if (input?.isSubscribed) return false;
  const s = input?.trialWatchSettings ?? FAIL_CLOSED;
  if (!s.configLoaded) return false;
  if (!s.enableTrial && !s.enablePreviewAfterTrial) return false;
  return true;
}

function trialMsFromSettings(settings) {
  return Math.max(0, settings.trialMinutes) * 60 * 1000;
}

function previewMsFromSettings(settings) {
  return Math.max(0, settings.previewSeconds) * 1000;
}

function resolveTrialWatchAllowance(state, settings) {
  const trialBudget = trialMsFromSettings(settings);
  const previewBudget = previewMsFromSettings(settings);
  if (!settings.enableTrial && !settings.enablePreviewAfterTrial) {
    return { phase: 'blocked', remainingMs: 0 };
  }
  if (!state.trialExhausted && settings.enableTrial && trialBudget > 0) {
    const consumed = Math.min(trialBudget, Math.max(0, state.trialConsumedMs));
    const remaining = Math.max(0, trialBudget - consumed);
    if (remaining > 0) return { phase: 'trial', remainingMs: remaining };
  }
  if (settings.enablePreviewAfterTrial && previewBudget > 0) {
    return { phase: 'preview', remainingMs: previewBudget };
  }
  return { phase: 'blocked', remainingMs: 0 };
}

function run() {
  const empty = parseTrialWatchSettings(null);
  assert.strictEqual(empty.configLoaded, false);
  assert.strictEqual(empty.enableTrial, false);
  assert.strictEqual(
    shouldApplyTrialWatch({ isSubscribed: false, freeMode: false, trialWatchSettings: empty }),
    false,
  );

  const appModesOnly = parseTrialWatchSettings({
    ok: true,
    free_mode: false,
    maintenance_mode: false,
  });
  assert.strictEqual(appModesOnly.configLoaded, false);
  assert.strictEqual(appModesOnly.enableTrial, false);

  const runtimeDisabled = parseTrialWatchSettings({
    ok: true,
    trial_watch_enabled: false,
    trialWatchEnabled: false,
    trial_watch_minutes: 5,
    trial_preview_seconds: 11,
    trial_preview_after_enabled: false,
  });
  assert.strictEqual(runtimeDisabled.configLoaded, true);
  assert.strictEqual(runtimeDisabled.enableTrial, false);
  assert.strictEqual(
    shouldApplyTrialWatch({
      isSubscribed: false,
      freeMode: false,
      trialWatchSettings: runtimeDisabled,
    }),
    false,
  );
  assert.strictEqual(
    resolveTrialWatchAllowance({ trialConsumedMs: 0, trialExhausted: false }, runtimeDisabled).phase,
    'blocked',
  );

  const runtimeEnabled = parseTrialWatchSettings({
    enable_trial: true,
    trial_minutes: 5,
    preview_seconds: 11,
    enable_preview_after_trial: true,
  });
  assert.strictEqual(runtimeEnabled.configLoaded, true);
  assert.strictEqual(shouldApplyTrialWatch({ isSubscribed: false, trialWatchSettings: runtimeEnabled }), true);

  const trialBudget = trialMsFromSettings(runtimeEnabled);
  const fresh = { trialConsumedMs: 0, trialExhausted: false };
  assert.strictEqual(resolveTrialWatchAllowance(fresh, runtimeEnabled).phase, 'trial');
  assert.strictEqual(resolveTrialWatchAllowance(fresh, runtimeEnabled).remainingMs, trialBudget);

  console.log('[verify-trial-watch] ok');
}

run();
