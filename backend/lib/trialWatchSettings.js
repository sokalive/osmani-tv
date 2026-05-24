/**
 * Merge admin trial-watch fields into viewer API responses (osmani-admin-api).
 *
 * Wire inside GET /api/runtime/app-modes or GET /api/banners-adjacent public settings:
 *   const { enrichAppModesForViewer } = require('./lib/trialWatchSettings');
 *   res.json(enrichAppModesForViewer(dbRow));
 */

const DEFAULT = {
  enable_trial: true,
  trial_minutes: 5,
  preview_seconds: 11,
  enable_preview_after_trial: true,
};

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

function coerceInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function trialFieldsFromRow(row) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    enable_trial: coerceBool(
      r.enable_trial ?? r.enableTrial ?? r.trial_enabled ?? r.trialEnabled,
      DEFAULT.enable_trial,
    ),
    trial_minutes: coerceInt(
      r.trial_minutes ?? r.trialMinutes ?? r.free_trial_minutes,
      DEFAULT.trial_minutes,
    ),
    preview_seconds: coerceInt(
      r.preview_seconds ?? r.previewSeconds ?? r.channel_preview_seconds,
      DEFAULT.preview_seconds,
    ),
    enable_preview_after_trial: coerceBool(
      r.enable_preview_after_trial ??
        r.enablePreviewAfterTrial ??
        r.preview_after_trial,
      DEFAULT.enable_preview_after_trial,
    ),
  };
}

function enrichAppModesForViewer(row) {
  const base = row && typeof row === 'object' ? { ...row } : {};
  const trial = trialFieldsFromRow(row);
  return {
    ...base,
    ...trial,
    enableTrial: trial.enable_trial,
    trialMinutes: trial.trial_minutes,
    previewSeconds: trial.preview_seconds,
    enablePreviewAfterTrial: trial.enable_preview_after_trial,
  };
}

module.exports = {
  DEFAULT,
  enrichAppModesForViewer,
  trialFieldsFromRow,
};
