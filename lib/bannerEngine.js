/**
 * Lovable-style Featured Banner runtime engine.
 *
 * Deterministic, side-effect-free state machine that maps a normalised
 * banner row + `nowMs` + admin-configurable thresholds → a render-ready
 * view object the carousel can render without further branching.
 *
 * Inputs the engine consumes from a banner row (set by `normalizeBanner`):
 *   - `eventStart` / `eventEnd`  : epoch ms (one-time anchor, or daily
 *                                  time-of-day source after EAT extract)
 *   - `repeatMode`               : 'none' | 'daily'
 *   - `timezone`                 : IANA tz string or null (engine falls
 *                                  back to `config.defaultTimezone`)
 *   - `isActive`                 : boolean (admin master toggle)
 *
 * Output (`computeBannerView`):
 *   { visible, state, badgeText, badgeColor, badgeBlink,
 *     countdownText, transitionFlash, occurrence }
 *
 * Default thresholds match the approved spec; admins override them at
 * runtime through `app_settings.banner_engine` (mobile reads via
 * `OsmaniAppContext.bannerEngineConfig`).
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
  HIDDEN: 'HIDDEN',                   // not visible at all
  COMING_NEXT: 'COMING_NEXT',         // far pre-live, badge: "COMING NEXT AT 7:10 PM"
  COMING_SOON: 'COMING_SOON',         // near pre-live, badge + STARTS IN clock
  TRANSITION_PRE: 'TRANSITION_PRE',   // last few seconds before start, flash
  LIVE_NOW: 'LIVE_NOW',               // active window, blinking LIVE badge
  TRANSITION_POST: 'TRANSITION_POST', // last few seconds before end, flash
  ENDED: 'ENDED',                     // grace window after end
  NONE: 'NONE',                       // banner has no schedule at all (legacy passthrough)
});

/**
 * Default per-state badge palette. Admin can override the *colour* per
 * banner via legacy `badge_color`; text + blink stay engine-controlled
 * for any scheduled banner.
 */
export const BANNER_BADGE_THEME = Object.freeze({
  COMING_NEXT:     { color: '#F5A623', blink: false },
  COMING_SOON:     { color: '#F5A623', blink: false },
  TRANSITION_PRE:  { color: '#1EC967', blink: true },
  LIVE_NOW:        { color: '#E63946', blink: true },
  TRANSITION_POST: { color: '#E63946', blink: true },
  ENDED:           { color: '#6B7280', blink: false },
});

/**
 * Engine thresholds. Admins can tune these at runtime through
 * `app_settings.banner_engine` (snake_case wire format) and the engine
 * coalesces them with these defaults.
 */
export const DEFAULT_ENGINE_CONFIG = Object.freeze({
  comingNextWindowMinutes: 360,        // 6h before start, "COMING NEXT AT …" appears
  comingSoonWindowMinutes: 15,         // last 15 min: switches to "COMING SOON" + STARTS IN clock
  transitionSeconds: 5,                // flash window around start and end
  endedGraceMinutes: 5,                // banner stays as ENDED for 5 min after end
  defaultTimezone: EAT_TIMEZONE,       // fallback for rows without an explicit tz
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
 * Coalesce a partial admin config (accepts both snake_case and camelCase)
 * with the defaults. Always returns a fully-populated config object.
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

/** Format a positive integer second count as `M:SS` or `H:MM:SS`. */
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
 * Build a single (start, end) occurrence at the given local date in `tz`,
 * extracting time-of-day from the banner's `eventStart`/`eventEnd` epoch ms
 * (interpreted in `tz`). When end-time ≤ start-time the engine treats the
 * window as wrapping past midnight — end shifts to the next calendar day.
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
 *   - one-time : the single (eventStart, eventEnd) window, raw.
 *   - daily    : today's window if upcoming/active/in-grace; otherwise
 *                tomorrow's projected window.
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

  // Daily — project today's time-of-day window in `tz`. If we're already
  // past today's grace, advance to tomorrow's occurrence.
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
 * Compute the runtime state for a banner at `nowMs`. Returns the resolved
 * occurrence + countdown helpers.
 *
 * @param {object} slide
 * @param {number} nowMs
 * @param {ReturnType<typeof mergeEngineConfig>} [config]
 * @returns {{ state: string, occurrence: { startMs: number, endMs: number } | null,
 *            secondsToStart: number | null, secondsToEnd: number | null }}
 */
export function computeBannerState(slide, nowMs, config) {
  const cfg = config || DEFAULT_ENGINE_CONFIG;
  const occurrence = computeNextOccurrence(slide, nowMs, cfg);

  if (occurrence == null) {
    return { state: BANNER_STATES.NONE, occurrence: null, secondsToStart: null, secondsToEnd: null };
  }

  const { startMs, endMs } = occurrence;
  const transitionMs = cfg.transitionSeconds * 1000;
  const comingSoonMs = cfg.comingSoonWindowMinutes * 60 * 1000;
  const comingNextMs = cfg.comingNextWindowMinutes * 60 * 1000;
  const endedGraceMs = cfg.endedGraceMinutes * 60 * 1000;

  const dtToStart = startMs - nowMs;
  const dtAfterEnd = nowMs - endMs;
  const secondsToStart = Math.max(0, Math.ceil(dtToStart / 1000));
  const secondsToEnd = Math.max(0, Math.ceil((endMs - nowMs) / 1000));

  let state;
  if (dtToStart > comingNextMs) {
    state = BANNER_STATES.HIDDEN;
  } else if (dtToStart > comingSoonMs) {
    state = BANNER_STATES.COMING_NEXT;
  } else if (dtToStart > transitionMs) {
    state = BANNER_STATES.COMING_SOON;
  } else if (dtToStart > 0) {
    state = BANNER_STATES.TRANSITION_PRE;
  } else if (nowMs < endMs - transitionMs) {
    state = BANNER_STATES.LIVE_NOW;
  } else if (nowMs <= endMs) {
    state = BANNER_STATES.TRANSITION_POST;
  } else if (dtAfterEnd <= endedGraceMs) {
    state = BANNER_STATES.ENDED;
  } else {
    state = BANNER_STATES.HIDDEN;
  }

  return { state, occurrence, secondsToStart, secondsToEnd };
}

/**
 * Render-ready view for the carousel. Combines state, theme, formatted
 * countdown, and the transition flash flag so the slide component can
 * render without further conditional branching.
 *
 * For unscheduled banners (state = NONE) the engine returns
 * `visible: true` with empty badge fields so the carousel can fall back
 * to the legacy admin badge fields (no engine override).
 *
 * @param {object} slide
 * @param {number} nowMs
 * @param {ReturnType<typeof mergeEngineConfig>} [config]
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
      visible: true,
      state,
      badgeText: '',
      badgeColor: null,
      badgeBlink: false,
      countdownText: null,
      transitionFlash: false,
      occurrence: null,
    };
  }

  if (state === BANNER_STATES.HIDDEN) {
    return {
      visible: false,
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
    case BANNER_STATES.COMING_NEXT: {
      const at = formatClockInTz(occurrence.startMs, tz);
      badgeText = `COMING NEXT AT ${at}`;
      break;
    }
    case BANNER_STATES.COMING_SOON: {
      badgeText = 'COMING SOON';
      countdownText = `STARTS IN ${formatCountdownClock(secondsToStart)}`;
      break;
    }
    case BANNER_STATES.TRANSITION_PRE: {
      badgeText = 'STARTING NOW';
      countdownText = `STARTS IN ${formatCountdownClock(secondsToStart)}`;
      transitionFlash = true;
      break;
    }
    case BANNER_STATES.LIVE_NOW: {
      badgeText = 'LIVE NOW';
      break;
    }
    case BANNER_STATES.TRANSITION_POST: {
      badgeText = 'ENDING SOON';
      countdownText = `ENDS IN ${formatCountdownClock(secondsToEnd)}`;
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

  // Allow a per-banner colour override (`legacyBadgeColor`) to take
  // effect for engine-driven states too — text + blink stay engine-owned.
  const badgeColor = (typeof slide?.legacyBadgeColorOverride === 'string'
    && slide.legacyBadgeColorOverride.length > 0)
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
