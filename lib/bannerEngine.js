/**
 * Lovable-style Featured Banner runtime engine.
 *
 * IMPORTANT — banners are *always visible* in the carousel. The engine
 * NEVER hides a banner because of schedule state. The only way a banner
 * disappears is `is_active = false` on the row (admin master toggle) or
 * deletion. The state machine only swaps:
 *
 *   - badge text
 *   - badge color
 *   - badge blink
 *   - countdown line below the badge
 *   - brief transition flash (visual)
 *
 * State machine, in priority order over the relevant occurrence:
 *
 *   NONE             — banner has no schedule at all (legacy passthrough)
 *   NEXT_COMING_SOON — > comingNextWindowMinutes (default 6h) until start.
 *                       Badge: "NEXT COMING SOON", countdown: "H:MM"
 *   COMING_NEXT_AT   — between comingNextWindowMinutes and
 *                       comingSoonWindowMinutes before start.
 *                       Badge: "COMING NEXT AT 7:10 PM"
 *   COMING_SOON      — between comingSoonWindowMinutes and
 *                       swahiliCountdownMinutes before start.
 *                       Badge: "COMING SOON",
 *                       countdown: "Bado dakika X kuanza"
 *   SWAHILI_COUNTDOWN — between swahiliCountdownMinutes and
 *                       transitionSeconds before start.
 *                       Badge: "Bado dakika X kuanza" (or sekunde X for <1min)
 *   TRANSITION_PRE   — last transitionSeconds before start (flash).
 *                       Badge: "INAANZA SASA"
 *   LIVE_NOW         — during event (not in TRANSITION_POST window).
 *                       Badge: "LIVE NOW",
 *                       countdown: "Inaisha baada ya dakika X" when in last 30min
 *   TRANSITION_POST  — last transitionSeconds before end (flash).
 *                       Badge: "INAISHA SASA"
 *   ENDED            — within endedGraceMinutes (default 3) after end.
 *                       Badge: "ENDED"
 *
 * Daily-repeat rows automatically project to the next day after ENDED
 * grace; one-time rows past grace fall back to NONE so legacy admin
 * badge fields still apply (banner stays visible either way).
 *
 * No I/O. Designed for one 1Hz tick from the carousel — every derivation
 * is O(1).
 */

import {
  EAT_TIMEZONE,
  addDaysInTz,
  epochMsForLocal,
  formatClockInTz,
  getTimeOfDayInTz,
  getTzParts,
} from './timeEat.js';

/** Discrete runtime states emitted by the engine. */
export const BANNER_STATES = Object.freeze({
  NONE: 'NONE',
  NEXT_COMING_SOON: 'NEXT_COMING_SOON',
  COMING_NEXT_AT: 'COMING_NEXT_AT',
  COMING_SOON: 'COMING_SOON',
  SWAHILI_COUNTDOWN: 'SWAHILI_COUNTDOWN',
  TRANSITION_PRE: 'TRANSITION_PRE',
  LIVE_NOW: 'LIVE_NOW',
  TRANSITION_POST: 'TRANSITION_POST',
  ENDED: 'ENDED',
});

/**
 * Default per-state badge palette (broadcast-TV vibe). Admin can
 * override the colour per banner via legacy `badge_color`; text + blink
 * remain engine-controlled for any scheduled banner.
 */
export const BANNER_BADGE_THEME = Object.freeze({
  NEXT_COMING_SOON:  { color: '#475569', blink: false }, // slate
  COMING_NEXT_AT:    { color: '#475569', blink: false }, // slate
  COMING_SOON:       { color: '#F5A623', blink: false }, // amber
  SWAHILI_COUNTDOWN: { color: '#F5A623', blink: false }, // amber
  TRANSITION_PRE:    { color: '#1EC967', blink: true  }, // green flash
  LIVE_NOW:          { color: '#E63946', blink: true  }, // red
  TRANSITION_POST:   { color: '#E63946', blink: true  }, // red flash
  ENDED:             { color: '#6B7280', blink: false }, // grey
});

/**
 * Engine thresholds. Admins can tune these at runtime through
 * `app_settings.banner_engine` (snake_case wire format).
 *
 * Defaults match the approved spec:
 *   - 6h before start            -> COMING_NEXT_AT (clock label)
 *   - 15min                      -> COMING_SOON
 *   - 5min                       -> SWAHILI_COUNTDOWN
 *   - 5s                         -> TRANSITION_PRE / TRANSITION_POST
 *   - 3min                       -> ENDED grace
 */
export const DEFAULT_ENGINE_CONFIG = Object.freeze({
  comingNextWindowMinutes: 360,
  comingSoonWindowMinutes: 15,
  swahiliCountdownMinutes: 5,
  transitionSeconds: 5,
  endedGraceMinutes: 3,
  defaultTimezone: EAT_TIMEZONE,
});

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function strOr(v, fallback) {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : fallback;
}

/**
 * Coalesce a partial admin config (snake_case or camelCase) with the
 * defaults. Always returns a fully-populated config object.
 *
 * @param {Record<string, unknown> | null | undefined} partial
 */
export function mergeEngineConfig(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  return {
    comingNextWindowMinutes: numOr(
      p.coming_next_window_minutes ?? p.comingNextWindowMinutes,
      DEFAULT_ENGINE_CONFIG.comingNextWindowMinutes,
    ),
    comingSoonWindowMinutes: numOr(
      p.coming_soon_window_minutes ?? p.comingSoonWindowMinutes,
      DEFAULT_ENGINE_CONFIG.comingSoonWindowMinutes,
    ),
    swahiliCountdownMinutes: numOr(
      p.swahili_countdown_minutes ?? p.swahiliCountdownMinutes,
      DEFAULT_ENGINE_CONFIG.swahiliCountdownMinutes,
    ),
    transitionSeconds: numOr(
      p.transition_seconds ?? p.transitionSeconds,
      DEFAULT_ENGINE_CONFIG.transitionSeconds,
    ),
    endedGraceMinutes: numOr(
      p.ended_grace_minutes ?? p.endedGraceMinutes,
      DEFAULT_ENGINE_CONFIG.endedGraceMinutes,
    ),
    defaultTimezone: strOr(
      p.default_timezone ?? p.defaultTimezone,
      DEFAULT_ENGINE_CONFIG.defaultTimezone,
    ),
  };
}

/** Format integer seconds as `M:SS` or `H:MM:SS`. */
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

/**
 * Format integer seconds as `H:MM` (hours+minutes, no seconds) or
 * `MM:SS` when under 1h. Used for the NEXT_COMING_SOON label like
 * "1:28" — a delta countdown to the next event.
 */
export function formatCountdownGap(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  if (h > 0) {
    const m = Math.floor((s % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Swahili pre-event countdown phrasing.
 *   < 60s  : "Bado sekunde X kuanza"
 *   >= 60s : "Bado dakika X kuanza"
 *
 * @param {number} totalSec — seconds until start (positive)
 */
export function formatSwahiliPre(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  if (s < 60) {
    return `Bado sekunde ${s} kuanza`;
  }
  const m = Math.ceil(s / 60);
  return `Bado dakika ${m} kuanza`;
}

/**
 * Swahili in-event remaining-time phrasing.
 *   < 60s  : "Inaisha sekunde X"
 *   >= 60s : "Inaisha baada ya dakika X"
 */
export function formatSwahiliPost(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  if (s < 60) {
    return `Inaisha sekunde ${s}`;
  }
  const m = Math.ceil(s / 60);
  return `Inaisha baada ya dakika ${m}`;
}

/**
 * Build a single (start, end) occurrence at the given local date in `tz`,
 * extracting time-of-day from the banner's `eventStart`/`eventEnd` epoch
 * ms (interpreted in `tz`). Wraps past midnight when end ≤ start.
 */
function buildOccurrenceForDate(slide, dateParts, tz) {
  const startTod = getTimeOfDayInTz(slide.eventStart, tz);
  const endTod = getTimeOfDayInTz(slide.eventEnd, tz);
  if (!startTod || !endTod) return null;
  const startMs = epochMsForLocal(
    dateParts.year, dateParts.month, dateParts.day,
    startTod.hour, startTod.minute, startTod.second, tz,
  );
  let endMs = epochMsForLocal(
    dateParts.year, dateParts.month, dateParts.day,
    endTod.hour, endTod.minute, endTod.second, tz,
  );
  if (endMs <= startMs) {
    const next = addDaysInTz(dateParts.year, dateParts.month, dateParts.day, 1);
    endMs = epochMsForLocal(
      next.year, next.month, next.day,
      endTod.hour, endTod.minute, endTod.second, tz,
    );
  }
  return { startMs, endMs };
}

/**
 * Resolve the banner's *relevant* occurrence at `nowMs`:
 *   - one-time : the single (eventStart, eventEnd) window. Returned even
 *                after grace (engine maps it to NONE in that case).
 *   - daily    : today's window if upcoming/active/in-grace; otherwise
 *                tomorrow's projected window (auto-repeat — admin never
 *                manually reschedules).
 * Returns null if the banner has no schedule at all.
 *
 * @param {object} slide
 * @param {number} nowMs
 * @param {ReturnType<typeof mergeEngineConfig>} [config]
 * @returns {{ startMs: number, endMs: number } | null}
 */
export function computeNextOccurrence(slide, nowMs, config) {
  const cfg = config || DEFAULT_ENGINE_CONFIG;
  const repeatMode = String(slide?.repeatMode ?? 'none').toLowerCase();
  const tz = (typeof slide?.timezone === 'string' && slide.timezone.trim().length > 0)
    ? slide.timezone
    : cfg.defaultTimezone;

  if (slide?.eventStart == null || slide?.eventEnd == null) return null;

  if (repeatMode !== 'daily') {
    return { startMs: slide.eventStart, endMs: slide.eventEnd };
  }

  // Daily — project today's time-of-day window in `tz`. Past today's
  // grace, advance to tomorrow's occurrence (Event Timer auto-repeat).
  const today = getTzParts(nowMs, tz);
  const todayOcc = buildOccurrenceForDate(slide, today, tz);
  if (!todayOcc) return null;
  const endedGraceMs = cfg.endedGraceMinutes * 60 * 1000;
  if (nowMs <= todayOcc.endMs + endedGraceMs) {
    return todayOcc;
  }
  const tomorrow = addDaysInTz(today.year, today.month, today.day, 1);
  return buildOccurrenceForDate(slide, tomorrow, tz);
}

/**
 * Compute the runtime state for a banner at `nowMs`. Returns the
 * resolved occurrence + countdown helpers. Banners are *always* in the
 * carousel — `state` only drives the badge/countdown render.
 */
export function computeBannerState(slide, nowMs, config) {
  const cfg = config || DEFAULT_ENGINE_CONFIG;
  const occurrence = computeNextOccurrence(slide, nowMs, cfg);

  if (occurrence == null) {
    return { state: BANNER_STATES.NONE, occurrence: null, secondsToStart: null, secondsToEnd: null };
  }

  const { startMs, endMs } = occurrence;
  const transitionMs = cfg.transitionSeconds * 1000;
  const swahiliMs = cfg.swahiliCountdownMinutes * 60 * 1000;
  const comingSoonMs = cfg.comingSoonWindowMinutes * 60 * 1000;
  const comingNextMs = cfg.comingNextWindowMinutes * 60 * 1000;
  const endedGraceMs = cfg.endedGraceMinutes * 60 * 1000;

  const dtToStart = startMs - nowMs;
  const dtAfterEnd = nowMs - endMs;
  const secondsToStart = Math.max(0, Math.ceil(dtToStart / 1000));
  const secondsToEnd = Math.max(0, Math.ceil((endMs - nowMs) / 1000));

  let state;
  if (dtToStart > 0) {
    if (dtToStart <= transitionMs)        state = BANNER_STATES.TRANSITION_PRE;
    else if (dtToStart <= swahiliMs)      state = BANNER_STATES.SWAHILI_COUNTDOWN;
    else if (dtToStart <= comingSoonMs)   state = BANNER_STATES.COMING_SOON;
    else if (dtToStart <= comingNextMs)   state = BANNER_STATES.COMING_NEXT_AT;
    else                                  state = BANNER_STATES.NEXT_COMING_SOON;
  } else if (nowMs <= endMs) {
    if (endMs - nowMs <= transitionMs)    state = BANNER_STATES.TRANSITION_POST;
    else                                  state = BANNER_STATES.LIVE_NOW;
  } else if (dtAfterEnd <= endedGraceMs) {
    state = BANNER_STATES.ENDED;
  } else {
    // One-time row past grace with no future occurrence — engine yields
    // NONE so the legacy admin badge fields render through and the
    // banner stays visible in the carousel.
    state = BANNER_STATES.NONE;
  }

  return { state, occurrence, secondsToStart, secondsToEnd };
}

/**
 * Render-ready view for the carousel. ALWAYS returns `visible: true`
 * (the carousel is gated by `slide.isActive` only). The state field
 * drives badge/countdown/blink/colors/transitions exclusively.
 *
 * For unscheduled rows (state = NONE) the engine returns empty badge
 * fields so the carousel falls back to the legacy admin badge fields.
 */
export function computeBannerView(slide, nowMs, config) {
  const cfg = config || DEFAULT_ENGINE_CONFIG;
  const tz = (typeof slide?.timezone === 'string' && slide.timezone.trim().length > 0)
    ? slide.timezone
    : cfg.defaultTimezone;
  const { state, occurrence, secondsToStart, secondsToEnd } =
    computeBannerState(slide, nowMs, cfg);

  if (state === BANNER_STATES.NONE) {
    return {
      visible: true, // banners always visible; admin uses isActive
      state,
      badgeText: '',
      badgeColor: null,
      badgeBlink: false,
      countdownText: null,
      transitionFlash: false,
      occurrence: null,
    };
  }

  const theme = BANNER_BADGE_THEME[state] || { color: '#FFFFFF', blink: false };
  let badgeText = '';
  let countdownText = null;
  let transitionFlash = false;

  switch (state) {
    case BANNER_STATES.NEXT_COMING_SOON: {
      badgeText = 'NEXT COMING SOON';
      countdownText = formatCountdownGap(secondsToStart);
      break;
    }
    case BANNER_STATES.COMING_NEXT_AT: {
      const at = formatClockInTz(occurrence.startMs, tz);
      badgeText = `COMING NEXT AT ${at}`;
      break;
    }
    case BANNER_STATES.COMING_SOON: {
      badgeText = 'COMING SOON';
      countdownText = formatSwahiliPre(secondsToStart);
      break;
    }
    case BANNER_STATES.SWAHILI_COUNTDOWN: {
      // Last few minutes — Swahili countdown becomes the primary label.
      badgeText = formatSwahiliPre(secondsToStart);
      break;
    }
    case BANNER_STATES.TRANSITION_PRE: {
      badgeText = 'INAANZA SASA';
      countdownText = formatSwahiliPre(secondsToStart);
      transitionFlash = true;
      break;
    }
    case BANNER_STATES.LIVE_NOW: {
      badgeText = 'LIVE NOW';
      // Show Swahili "Inaisha baada ya dakika X" only when within the
      // last 30min of the event so it doesn't dominate the slide
      // throughout long events.
      if (secondsToEnd <= 30 * 60) {
        countdownText = formatSwahiliPost(secondsToEnd);
      }
      break;
    }
    case BANNER_STATES.TRANSITION_POST: {
      badgeText = 'INAISHA SASA';
      countdownText = formatSwahiliPost(secondsToEnd);
      transitionFlash = true;
      break;
    }
    case BANNER_STATES.ENDED: {
      badgeText = 'ENDED';
      break;
    }
    default:
      break;
  }

  // Allow a per-banner colour override for engine-driven states. Text +
  // blink stay engine-owned.
  const badgeColor =
    typeof slide?.legacyBadgeColorOverride === 'string'
    && slide.legacyBadgeColorOverride.length > 0
      ? slide.legacyBadgeColorOverride
      : theme.color;

  return {
    visible: true,
    state,
    badgeText,
    badgeColor,
    badgeBlink: theme.blink,
    countdownText,
    transitionFlash,
    occurrence,
  };
}
