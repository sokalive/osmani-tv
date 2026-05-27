/**
 * Admin-configurable trial / preview limits for non-subscribed viewers.
 * Fail-closed: trial never runs until runtime config is loaded and explicitly enabled.
 */

/** Premium locked until viewer-safe runtime trial config is fetched. */
export const TRIAL_WATCH_FAIL_CLOSED = Object.freeze({
  enableTrial: false,
  trialMinutes: 0,
  previewSeconds: 0,
  enablePreviewAfterTrial: false,
  configLoaded: false,
});

/** @deprecated Use TRIAL_WATCH_FAIL_CLOSED — kept for imports. */
export const DEFAULT_TRIAL_WATCH_SETTINGS = TRIAL_WATCH_FAIL_CLOSED;

const NUM_DEFAULT_MINUTES = 5;
const NUM_DEFAULT_PREVIEW = 11;

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

function collectCandidates(payload) {
  const candidates = [];
  const push = (x) => {
    if (x && typeof x === 'object' && !candidates.includes(x)) candidates.push(x);
  };
  push(payload);
  if (payload && typeof payload === 'object') {
    push(payload.payload);
    push(payload.data);
    push(payload.body);
    push(payload.settings);
    push(payload.current_settings);
    push(payload.app_settings);
    push(payload.trial_watch);
    push(payload.trialWatch);
    push(payload.config);
    if (payload.config && typeof payload.config === 'object') {
      push(payload.config.trial_watch);
      push(payload.config.trialWatch);
    }
  }
  return candidates;
}

/**
 * Parse viewer/runtime trial-watch payload. Never enables trial unless explicit flags exist.
 * @param {unknown} payload
 * @returns {typeof TRIAL_WATCH_FAIL_CLOSED & { configLoaded: boolean }}
 */
export function parseTrialWatchSettings(payload) {
  const out = {
    enableTrial: false,
    trialMinutes: 0,
    previewSeconds: 0,
    enablePreviewAfterTrial: false,
    configLoaded: false,
  };

  for (const o of collectCandidates(payload)) {
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
      'free_trial_minutes',
      'freeTrialMinutes',
      'trial_watch_minutes',
      'trialWatchMinutes',
    ]);
    if (trialMinutes !== undefined) {
      out.trialMinutes = coercePositiveInt(trialMinutes, NUM_DEFAULT_MINUTES);
    }

    const previewSeconds = pickDefined(o, [
      'preview_seconds',
      'previewSeconds',
      'channel_preview_seconds',
      'channelPreviewSeconds',
      'trial_preview_seconds',
      'trialPreviewSeconds',
    ]);
    if (previewSeconds !== undefined) {
      out.previewSeconds = coercePositiveInt(previewSeconds, NUM_DEFAULT_PREVIEW);
    }

    const enablePreview = pickDefined(o, [
      'enable_preview_after_trial',
      'enablePreviewAfterTrial',
      'preview_after_trial',
      'previewAfterTrial',
      'trial_preview_after_enabled',
      'trialPreviewAfterEnabled',
    ]);
    if (enablePreview !== undefined) {
      out.enablePreviewAfterTrial = coerceBool(enablePreview, false);
      out.configLoaded = true;
    }
  }

  if (out.configLoaded) {
    if (out.enableTrial && out.trialMinutes <= 0) {
      out.trialMinutes = NUM_DEFAULT_MINUTES;
    }
    if (out.enablePreviewAfterTrial && out.previewSeconds <= 0) {
      out.previewSeconds = NUM_DEFAULT_PREVIEW;
    }
  }

  return out;
}

/**
 * @param {{ isSubscribed?: boolean; freeMode?: boolean; trialWatchSettings?: typeof TRIAL_WATCH_FAIL_CLOSED }} input
 */
export function shouldApplyTrialWatch(input) {
  if (input?.freeMode) return false;
  if (input?.isSubscribed) return false;
  const s = input?.trialWatchSettings;
  if (!s?.configLoaded) return false;
  if (!s.enableTrial && !s.enablePreviewAfterTrial) return false;
  return true;
}

export function trialMsFromSettings(settings) {
  const s = settings ?? TRIAL_WATCH_FAIL_CLOSED;
  return Math.max(0, s.trialMinutes) * 60 * 1000;
}

export function previewMsFromSettings(settings) {
  const s = settings ?? TRIAL_WATCH_FAIL_CLOSED;
  return Math.max(0, s.previewSeconds) * 1000;
}
