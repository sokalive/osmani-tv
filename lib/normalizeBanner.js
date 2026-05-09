import {
  DEFAULT_TIMEZONE,
  ENDED_GRACE_MS,
  LEAD_NEXT_MS,
  LEAD_SOON_MS,
  TRANSITION_MS,
  formatLocalAtTime,
  isInTransition,
  parseLocalTime,
  resolveDailyWindow,
} from './bannerSchedule.js';

function parseTs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * Default per-state badge palette (Lovable look). Each banner row may
 * override `badgeColor` from the admin UI; when set the override wins for
 * any state where the admin explicitly opted-in via `badgeColor`.
 */
const STATE_DEFAULT_COLORS = Object.freeze({
  LIVE: '#DC2626', // red
  COMING_SOON: '#F59E0B', // amber
  COMING_NEXT: '#475569', // slate
  ENDED: '#6B7280', // grey
});

/** Backend `schedule_kind` enum. Falls back to `one_time`. */
function normalizeScheduleKind(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'daily' ? 'daily' : 'one_time';
}

/**
 * API → app shape (camelCase). Preserves array index order — do not
 * re-sort. Adds Lovable-engine schedule fields (`scheduleKind`, daily
 * window, timezone) without breaking existing one-time rows.
 *
 * @param {Record<string, unknown>} raw
 * @param {number} index
 */
export function normalizeBanner(raw, index) {
  const id =
    raw?.id != null
      ? String(raw.id)
      : raw?._id != null
        ? String(raw._id)
        : `banner-${index}`;

  const title = raw?.title != null ? String(raw.title).trim() : '';
  const description =
    raw?.description != null && String(raw.description).trim() !== ''
      ? String(raw.description).trim()
      : '';

  /** Use `image_url` as sent by the API (no static/demo URLs). */
  const imageUrl =
    raw?.image_url != null ? String(raw.image_url).trim() : '';

  // --- legacy admin-controlled badge fields (kept as optional overrides) ---
  // The Lovable engine generates badge text and color automatically from
  // schedule state. These columns now serve only as opt-in overrides for
  // banners that should keep a fixed, manually-curated badge regardless of
  // schedule (e.g. evergreen "BURE" / promo banners with no event).
  const badgeEnabledRaw = raw?.badge_enabled ?? raw?.badgeEnabled;
  const badgeEnabledOverride = badgeEnabledRaw == null ? null : Boolean(badgeEnabledRaw);
  const badgeBlinkOverride = (() => {
    const v = raw?.badge_blink ?? raw?.badgeBlink;
    return v == null ? null : Boolean(v);
  })();
  const badgeColorRaw = String(raw?.badge_color ?? raw?.badgeColor ?? '').trim();
  const badgeColorOverride = badgeColorRaw || null;
  const badgeTextOverride = (() => {
    const v = raw?.badge ?? raw?.badge_text ?? raw?.badgeText ?? raw?.badge_label ?? raw?.badgeLabel;
    if (v == null) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  })();

  // Legacy `enable_countdown` flag is preserved for backward compat but the
  // new engine derives countdown visibility from schedule state — every
  // scheduled banner gets a countdown automatically.
  const enableCountdown = Boolean(raw?.enable_countdown ?? raw?.enableCountdown ?? false);

  const scheduleKind = normalizeScheduleKind(raw?.schedule_kind ?? raw?.scheduleKind);
  const scheduleTimezone = (() => {
    const v = String(raw?.schedule_timezone ?? raw?.scheduleTimezone ?? '').trim();
    return v || DEFAULT_TIMEZONE;
  })();
  const eventStart = parseTs(raw?.event_start ?? raw?.eventStart);
  const eventEnd = parseTs(raw?.event_end ?? raw?.eventEnd);
  const dailyStart = parseLocalTime(raw?.daily_start_local ?? raw?.dailyStartLocal);
  const dailyEnd = parseLocalTime(raw?.daily_end_local ?? raw?.dailyEndLocal);
  const dailyDaysMaskRaw = Number(raw?.daily_days_mask ?? raw?.dailyDaysMask);
  const dailyDaysMask = Number.isFinite(dailyDaysMaskRaw) ? dailyDaysMaskRaw : 127;

  const isActiveRaw = raw?.is_active ?? raw?.isActive;
  const isActive = isActiveRaw == null ? true : Boolean(isActiveRaw);

  const rid = raw?.redirect_channel_id ?? raw?.redirectChannelId;
  const redirectChannelId =
    rid != null && String(rid).trim() !== '' ? String(rid).trim() : null;

  return {
    id,
    title,
    description,
    imageUrl,
    isActive,

    // Legacy override fields — null when admin didn't set them so the
    // engine knows it can fall back to per-state defaults.
    badgeEnabledOverride,
    badgeBlinkOverride,
    badgeColorOverride,
    badgeTextOverride,

    // Legacy boolean — kept so old rows without schedule still render
    // their stored countdown toggle. New scheduled rows ignore it.
    enableCountdown,

    // Schedule.
    scheduleKind,
    scheduleTimezone,
    eventStart,
    eventEnd,
    dailyStart,
    dailyEnd,
    dailyDaysMask,

    redirectChannelId,
  };
}

/**
 * Resolve the active and next event window for a banner at `nowMs`.
 * Returns `{ currentStart, currentEnd, nextStart, nextEnd }` (each may be
 * null) or null if the banner has no schedule at all.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 */
export function resolveBannerWindow(slide, nowMs) {
  if (slide.scheduleKind === 'daily' && slide.dailyStart && slide.dailyEnd) {
    return resolveDailyWindow(
      {
        startHour: slide.dailyStart.hour,
        startMinute: slide.dailyStart.minute,
        endHour: slide.dailyEnd.hour,
        endMinute: slide.dailyEnd.minute,
        daysMask: slide.dailyDaysMask,
      },
      nowMs,
      slide.scheduleTimezone,
    );
  }
  if (slide.eventStart != null || slide.eventEnd != null) {
    const start = slide.eventStart ?? null;
    const end = slide.eventEnd ?? null;

    // Active window — `nowMs` is between start and end (inclusive on both
    // sides; end-bound only when an explicit end is set).
    const inLive =
      start != null && nowMs >= start &&
      (end == null || nowMs <= end);
    if (inLive) {
      return { currentStart: start, currentEnd: end, nextStart: null, nextEnd: null };
    }

    // Elapsed — surface as `current*` so ENDED grace can pick it up.
    const elapsed =
      end != null ? nowMs > end :
      start != null ? nowMs > start :
      false;
    if (elapsed) {
      return { currentStart: start, currentEnd: end, nextStart: null, nextEnd: null };
    }

    // Future — surface as `next*` so COMING_SOON / COMING_NEXT can fire.
    return { currentStart: null, currentEnd: null, nextStart: start, nextEnd: end };
  }
  return null;
}

/**
 * Compute the runtime state for a banner. The state drives the auto-badge,
 * countdown, and visibility logic:
 *
 *   LIVE         — currently inside an event window
 *   COMING_SOON  — within `LEAD_SOON_MS` of next start
 *   COMING_NEXT  — within `LEAD_NEXT_MS` of next start (but past COMING_SOON)
 *   TRANSITION   — within `TRANSITION_MS` of any window edge (overlay
 *                  driven; the carousel uses this for crossfade only)
 *   ENDED        — within `ENDED_GRACE_MS` after most recent end
 *   IDLE         — banner has a schedule but no upcoming or active window
 *                  is close enough to label
 *   NONE         — banner has no schedule at all
 *
 * Returns `{ state, transition, currentStart, currentEnd, nextStart, nextEnd }`.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 */
export function computeBannerState(slide, nowMs) {
  const win = resolveBannerWindow(slide, nowMs);
  if (!win) {
    return {
      state: 'NONE',
      transition: false,
      currentStart: null,
      currentEnd: null,
      nextStart: null,
      nextEnd: null,
    };
  }
  const { currentStart, currentEnd, nextStart, nextEnd } = win;

  let state = 'IDLE';

  // LIVE: inside an active window.
  if (
    currentStart != null && currentEnd != null &&
    nowMs >= currentStart && nowMs <= currentEnd
  ) {
    state = 'LIVE';
  } else if (currentEnd != null && nowMs > currentEnd && nowMs - currentEnd <= ENDED_GRACE_MS) {
    state = 'ENDED';
  } else if (nextStart != null) {
    const lead = nextStart - nowMs;
    if (lead > 0 && lead <= LEAD_SOON_MS) state = 'COMING_SOON';
    else if (lead > 0 && lead <= LEAD_NEXT_MS) state = 'COMING_NEXT';
  }

  const transition =
    isInTransition({ start: currentStart, end: currentEnd }, nowMs) ||
    isInTransition({ start: nextStart, end: nextEnd }, nowMs);

  return {
    state,
    transition,
    currentStart,
    currentEnd,
    nextStart,
    nextEnd,
  };
}

/**
 * Visibility for the carousel filter. Banners with no schedule (`NONE`) are
 * always visible while `is_active` is true. Scheduled banners are visible
 * during their active or pre/post lifecycle window (LIVE / COMING_SOON /
 * COMING_NEXT / TRANSITION / ENDED). When the banner has a schedule but
 * no nearby window it is hidden.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 */
export function isBannerVisibleAt(slide, nowMs) {
  if (slide.isActive === false) return false;
  const { state } = computeBannerState(slide, nowMs);
  if (state === 'NONE') return true;
  return state !== 'IDLE';
}

/**
 * Compose the auto-generated badge for a banner state.
 *
 * Returns `{ enabled, text, color, blink }` so the carousel can render
 * without further branching. Honours admin overrides only when the
 * banner has no schedule (state === 'NONE'); for scheduled banners the
 * engine is authoritative.
 *
 * Color override is honoured per-state when admin provided one.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {ReturnType<typeof computeBannerState>} computed
 */
export function getAutoBadge(slide, computed) {
  if (computed.state === 'NONE') {
    // Static banner — surface admin overrides verbatim.
    if (
      slide.badgeEnabledOverride === false ||
      !slide.badgeTextOverride
    ) {
      return { enabled: false, text: '', color: '#000000', blink: false };
    }
    return {
      enabled: slide.badgeEnabledOverride !== false,
      text: slide.badgeTextOverride,
      color: slide.badgeColorOverride || '#DC2626',
      blink: slide.badgeBlinkOverride === true,
    };
  }
  if (computed.state === 'IDLE') {
    return { enabled: false, text: '', color: '#000000', blink: false };
  }

  let text = '';
  let color = STATE_DEFAULT_COLORS.LIVE;
  let blink = false;

  switch (computed.state) {
    case 'LIVE':
      text = 'LIVE NOW';
      color = STATE_DEFAULT_COLORS.LIVE;
      blink = true;
      break;
    case 'COMING_SOON':
      text = 'COMING SOON';
      color = STATE_DEFAULT_COLORS.COMING_SOON;
      blink = false;
      break;
    case 'COMING_NEXT': {
      if (computed.nextStart != null) {
        const at = formatLocalAtTime(computed.nextStart, slide.scheduleTimezone);
        text = `COMING NEXT AT ${at}`;
      } else {
        text = 'COMING NEXT';
      }
      color = STATE_DEFAULT_COLORS.COMING_NEXT;
      blink = false;
      break;
    }
    case 'ENDED':
      text = 'ENDED';
      color = STATE_DEFAULT_COLORS.ENDED;
      blink = false;
      break;
    default:
      break;
  }

  // Allow admin colour override per banner (e.g. branded LIVE colour).
  // Text + blink stay engine-controlled.
  const finalColor = slide.badgeColorOverride || color;

  return { enabled: text.length > 0, text, color: finalColor, blink };
}

/**
 * Countdown text for the slide. Driven from schedule state directly so
 * "STARTS IN" applies in COMING_SOON and "ENDS IN" applies in LIVE. Legacy
 * `enableCountdown` is honoured only when the banner has no schedule.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @param {ReturnType<typeof computeBannerState>} [precomputed]
 */
export function getCountdownState(slide, nowMs, precomputed) {
  const computed = precomputed || computeBannerState(slide, nowMs);

  if (computed.state === 'NONE') {
    // Backward-compat path for rows that pre-date the schedule engine.
    if (!slide.enableCountdown) return null;
    const start = slide.eventStart;
    const end = slide.eventEnd;
    if (start != null && nowMs < start) {
      return { prefix: 'STARTS IN', remainingSec: Math.max(0, Math.ceil((start - nowMs) / 1000)) };
    }
    if (start != null && end != null && nowMs >= start && nowMs <= end) {
      return { prefix: 'ENDS IN', remainingSec: Math.max(0, Math.ceil((end - nowMs) / 1000)) };
    }
    return null;
  }

  if (computed.state === 'LIVE' && computed.currentEnd != null) {
    return {
      prefix: 'ENDS IN',
      remainingSec: Math.max(0, Math.ceil((computed.currentEnd - nowMs) / 1000)),
    };
  }
  if ((computed.state === 'COMING_SOON' || computed.state === 'COMING_NEXT') && computed.nextStart != null) {
    return {
      prefix: 'STARTS IN',
      remainingSec: Math.max(0, Math.ceil((computed.nextStart - nowMs) / 1000)),
    };
  }
  return null;
}

/**
 * @param {number} totalSec
 */
export function formatCountdownClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export { TRANSITION_MS, LEAD_SOON_MS, LEAD_NEXT_MS, ENDED_GRACE_MS };
