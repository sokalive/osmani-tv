/**
 * Admin-configurable trial / preview limits for non-subscribed viewers.
 */

export const DEFAULT_TRIAL_WATCH_SETTINGS = Object.freeze({
  enableTrial: true,
  trialMinutes: 5,
  previewSeconds: 11,
  enablePreviewAfterTrial: true,
});

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
 * @param {unknown} payload
 * @returns {typeof DEFAULT_TRIAL_WATCH_SETTINGS}
 */
export function parseTrialWatchSettings(payload) {
  const out = { ...DEFAULT_TRIAL_WATCH_SETTINGS };
  for (const o of collectCandidates(payload)) {
    const enableTrial = pickDefined(o, [
      'enable_trial',
      'enableTrial',
      'trial_enabled',
      'trialEnabled',
    ]);
    if (enableTrial !== undefined) out.enableTrial = coerceBool(enableTrial, out.enableTrial);

    const trialMinutes = pickDefined(o, [
      'trial_minutes',
      'trialMinutes',
      'free_trial_minutes',
      'freeTrialMinutes',
    ]);
    if (trialMinutes !== undefined) {
      out.trialMinutes = coercePositiveInt(trialMinutes, out.trialMinutes);
    }

    const previewSeconds = pickDefined(o, [
      'preview_seconds',
      'previewSeconds',
      'channel_preview_seconds',
      'channelPreviewSeconds',
    ]);
    if (previewSeconds !== undefined) {
      out.previewSeconds = coercePositiveInt(previewSeconds, out.previewSeconds);
    }

    const enablePreview = pickDefined(o, [
      'enable_preview_after_trial',
      'enablePreviewAfterTrial',
      'preview_after_trial',
      'previewAfterTrial',
    ]);
    if (enablePreview !== undefined) {
      out.enablePreviewAfterTrial = coerceBool(enablePreview, out.enablePreviewAfterTrial);
    }
  }
  return out;
}

/**
 * @param {{ isSubscribed?: boolean; freeMode?: boolean; trialWatchSettings?: typeof DEFAULT_TRIAL_WATCH_SETTINGS }} input
 */
export function shouldApplyTrialWatch(input) {
  if (input?.freeMode) return false;
  if (input?.isSubscribed) return false;
  const s = input?.trialWatchSettings ?? DEFAULT_TRIAL_WATCH_SETTINGS;
  if (!s.enableTrial && !s.enablePreviewAfterTrial) return false;
  return true;
}

export function trialMsFromSettings(settings) {
  const s = settings ?? DEFAULT_TRIAL_WATCH_SETTINGS;
  return Math.max(0, s.trialMinutes) * 60 * 1000;
}

export function previewMsFromSettings(settings) {
  const s = settings ?? DEFAULT_TRIAL_WATCH_SETTINGS;
  return Math.max(0, s.previewSeconds) * 1000;
}
