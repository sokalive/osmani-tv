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

function parseTrialWatchSettings(payload) {
  const out = {
    enableTrial: true,
    trialMinutes: 5,
    previewSeconds: 11,
    enablePreviewAfterTrial: true,
  };
  const candidates = [payload];
  if (payload && typeof payload === 'object') {
    candidates.push(payload.payload, payload.data, payload.settings, payload.trial_watch);
  }
  for (const o of candidates) {
    if (!o || typeof o !== 'object') continue;
    const enableTrial = pickDefined(o, ['enable_trial', 'enableTrial']);
    if (enableTrial !== undefined) out.enableTrial = coerceBool(enableTrial, out.enableTrial);
    const trialMinutes = pickDefined(o, ['trial_minutes', 'trialMinutes']);
    if (trialMinutes !== undefined) out.trialMinutes = coercePositiveInt(trialMinutes, out.trialMinutes);
    const previewSeconds = pickDefined(o, ['preview_seconds', 'previewSeconds']);
    if (previewSeconds !== undefined) {
      out.previewSeconds = coercePositiveInt(previewSeconds, out.previewSeconds);
    }
    const enablePreview = pickDefined(o, ['enable_preview_after_trial', 'enablePreviewAfterTrial']);
    if (enablePreview !== undefined) {
      out.enablePreviewAfterTrial = coerceBool(enablePreview, out.enablePreviewAfterTrial);
    }
  }
  return out;
}

function shouldApplyTrialWatch(input) {
  if (input?.freeMode) return false;
  if (input?.isSubscribed) return false;
  const s = input?.trialWatchSettings ?? parseTrialWatchSettings(null);
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
  const admin = parseTrialWatchSettings({
    enable_trial: true,
    trial_minutes: 5,
    preview_seconds: 11,
    enable_preview_after_trial: true,
  });
  assert.strictEqual(admin.trialMinutes, 5);
  assert.strictEqual(admin.previewSeconds, 11);
  assert.strictEqual(shouldApplyTrialWatch({ isSubscribed: true, trialWatchSettings: admin }), false);
  assert.strictEqual(shouldApplyTrialWatch({ isSubscribed: false, freeMode: true, trialWatchSettings: admin }), false);
  assert.strictEqual(shouldApplyTrialWatch({ isSubscribed: false, freeMode: false, trialWatchSettings: admin }), true);

  const trialBudget = trialMsFromSettings(admin);
  const previewBudget = previewMsFromSettings(admin);
  const fresh = { trialConsumedMs: 0, trialExhausted: false };
  assert.strictEqual(resolveTrialWatchAllowance(fresh, admin).phase, 'trial');
  assert.strictEqual(resolveTrialWatchAllowance(fresh, admin).remainingMs, trialBudget);

  const done = { trialConsumedMs: trialBudget, trialExhausted: true };
  assert.strictEqual(resolveTrialWatchAllowance(done, admin).phase, 'preview');
  assert.strictEqual(resolveTrialWatchAllowance(done, admin).remainingMs, previewBudget);

  const blocked = resolveTrialWatchAllowance(done, {
    ...admin,
    enablePreviewAfterTrial: false,
  });
  assert.strictEqual(blocked.phase, 'blocked');

  console.log('[verify-trial-watch] ok');
}

run();
