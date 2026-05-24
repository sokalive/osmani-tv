/**
 * Shared banner viewer serializer (used by lib/ and backend/lib/ copies).
 */

export const RED_BADGE = '#DC2626';

function parseBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '' || s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  }
  return Boolean(v);
}

function hadRuntimeTimer(row) {
  return (
    parseBool(row?.use_timer ?? row?.useTimer) ||
    parseBool(row?.event_timer ?? row?.eventTimer) ||
    parseBool(row?.enable_countdown ?? row?.enableCountdown)
  );
}

function pickBadgeText(row) {
  const direct = String(
    row?.badge ?? row?.badge_text ?? row?.badgeText ?? row?.badge_label ?? row?.badgeLabel ?? '',
  ).trim();
  if (direct) return direct;
  if (hadRuntimeTimer(row)) return 'LIVE NOW';
  return '';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function enrichBannerForViewer(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };

  const badgeText = pickBadgeText(row);
  const badgeEnabled = parseBool(row?.badge_enabled ?? row?.badgeEnabled) || badgeText.length > 0;

  out.use_timer = false;
  out.useTimer = false;
  out.event_timer = false;
  out.eventTimer = false;
  out.enable_countdown = false;
  out.enableCountdown = false;
  out.countdown_enabled = false;
  out.countdownEnabled = false;
  out.timer_enabled = false;
  out.timerEnabled = false;

  out.badge_enabled = badgeEnabled;
  out.badgeEnabled = badgeEnabled;
  out.badge = badgeText;
  out.badge_text = badgeText;
  out.badgeText = badgeText;
  out.badge_color = RED_BADGE;
  out.badgeColor = RED_BADGE;
  out.badge_position = 'top_left';
  out.badgePosition = 'top_left';
  out.runtime_position = 'top_left';
  out.runtimePosition = 'top_left';

  return out;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function enrichBannersForViewer(value) {
  if (!Array.isArray(value)) return value;
  return value.map((row) => enrichBannerForViewer(row));
}
