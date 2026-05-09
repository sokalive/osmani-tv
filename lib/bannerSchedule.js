/**
 * Pure schedule engine for the Featured Banner system. No React, no
 * AsyncStorage, no network — just deterministic math from a banner row +
 * `nowMs` to a runtime state.
 *
 * Two schedule kinds are supported:
 *   - "one_time" : explicit `eventStart` / `eventEnd` epoch ms (UTC-aware ISO
 *     strings parsed once via `Date.parse`).
 *   - "daily"    : `dailyStartLocal` / `dailyEndLocal` HH:MM strings in the
 *     row's timezone (default `Africa/Dar_es_Salaam` / EAT). The engine
 *     resolves these to the next occurrence relative to `nowMs`. Wraps
 *     across midnight when end-time is earlier than start-time.
 *
 * Days-mask (`dailyDaysMask`) is a 7-bit field, bit 0 = Sunday … bit 6 =
 * Saturday. Default `127` means every weekday is enabled.
 *
 * The engine is intentionally backend-cheap: all derivations happen on the
 * device, and the carousel re-runs them on a single 1Hz interval. There is
 * no per-banner timer.
 */

/** Tunable thresholds — match Lovable defaults unless an override is set. */
export const LEAD_SOON_MS = 15 * 60 * 1000; // "COMING SOON" window before start
export const LEAD_NEXT_MS = 6 * 60 * 60 * 1000; // "COMING NEXT AT …" window before start
export const ENDED_GRACE_MS = 15 * 60 * 1000; // "ENDED" persists this long after end
export const TRANSITION_MS = 800; // crossfade window around state edges

/** Default timezone for daily schedules — EAT (UTC+3). */
export const DEFAULT_TIMEZONE = 'Africa/Dar_es_Salaam';

/** Cached `Intl.DateTimeFormat` instances keyed by timezone+locale+pattern. */
const fmtCache = new Map();

/**
 * @param {string} tz
 * @param {Intl.DateTimeFormatOptions} options
 */
function getFormatter(tz, options) {
  const key = `${tz}|${JSON.stringify(options)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...options });
    fmtCache.set(key, f);
  }
  return f;
}

/**
 * Returns the wall-clock components in `tz` for a given epoch ms.
 * `weekday` is 0..6 with Sunday=0 to match a JS `Date#getUTCDay()` call.
 *
 * @param {number} epochMs
 * @param {string} tz
 */
export function partsInTimezone(epochMs, tz) {
  const fmt = getFormatter(tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  const out = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
    weekday: 0,
  };
  for (const p of parts) {
    switch (p.type) {
      case 'year': out.year = Number(p.value); break;
      case 'month': out.month = Number(p.value); break;
      case 'day': out.day = Number(p.value); break;
      case 'hour':
        // `Intl` may return "24" for midnight in en-GB hour12:false. Normalise.
        out.hour = Number(p.value) % 24;
        break;
      case 'minute': out.minute = Number(p.value); break;
      case 'second': out.second = Number(p.value); break;
      case 'weekday': {
        const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        out.weekday = map[p.value] ?? 0;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Returns the timezone offset (ms) east of UTC for `epochMs` in `tz`.
 * Positive for EAT (UTC+3 → +10800000). Stable across DST boundaries
 * because it computes per-instant.
 *
 * @param {number} epochMs
 * @param {string} tz
 */
export function tzOffsetMs(epochMs, tz) {
  const p = partsInTimezone(epochMs, tz);
  // Construct the same wall-clock as if it were UTC, then diff.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - epochMs;
}

/**
 * Build an epoch-ms timestamp for `year/month/day hour:minute` interpreted in
 * `tz`. Uses a single tz-offset solve which is stable for non-ambiguous
 * civil times. EAT has no DST so this is exact.
 *
 * @param {number} year
 * @param {number} month0Indexed
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {string} tz
 */
export function epochMsForLocal(year, month0Indexed, day, hour, minute, tz) {
  const naiveUtc = Date.UTC(year, month0Indexed, day, hour, minute, 0);
  const offset = tzOffsetMs(naiveUtc, tz);
  return naiveUtc - offset;
}

/**
 * Parse "HH:MM" or "H:MM" (24-hour) into `{hour, minute}` or null.
 *
 * @param {unknown} v
 */
export function parseLocalTime(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Bitmask check. `mask` bit 0 = Sun … bit 6 = Sat.
 *
 * @param {number} mask
 * @param {number} weekday
 */
export function isWeekdayEnabled(mask, weekday) {
  if (!Number.isFinite(mask)) return true;
  if (weekday < 0 || weekday > 6) return false;
  return ((mask >> weekday) & 1) === 1;
}

/**
 * Resolve the most recent + next occurrence windows for a daily-repeat
 * schedule, anchored at `nowMs` in `tz`.
 *
 * Returns `{ currentStart, currentEnd, nextStart, nextEnd }` where each
 * value is epoch ms or null if no enabled day is reachable in 8 days.
 * `current*` is the window covering or last-elapsed before `nowMs`.
 * `next*` is the upcoming window strictly after `currentEnd` (or after
 * `nowMs` when current is null).
 *
 * Wraps across midnight when `end < start` (e.g. 22:00 → 02:00).
 *
 * @param {{ startHour: number; startMinute: number; endHour: number; endMinute: number; daysMask: number }} schedule
 * @param {number} nowMs
 * @param {string} tz
 */
export function resolveDailyWindow(schedule, nowMs, tz) {
  const local = partsInTimezone(nowMs, tz);
  const wraps =
    schedule.endHour < schedule.startHour ||
    (schedule.endHour === schedule.startHour && schedule.endMinute <= schedule.startMinute);

  /**
   * Build [start, end] for the schedule on the day `offset` days from the
   * local "today". Returns null if that weekday is disabled by the mask.
   *
   * `offset = 0` means today's start.
   *
   * @param {number} offset
   */
  const occurrenceForOffset = (offset) => {
    const dayBaseUtc = Date.UTC(local.year, local.month - 1, local.day);
    const candidate = new Date(dayBaseUtc + offset * 86400000);
    const cy = candidate.getUTCFullYear();
    const cm0 = candidate.getUTCMonth();
    const cd = candidate.getUTCDate();
    const startMs = epochMsForLocal(cy, cm0, cd, schedule.startHour, schedule.startMinute, tz);
    let endMs;
    if (wraps) {
      const next = new Date(dayBaseUtc + (offset + 1) * 86400000);
      endMs = epochMsForLocal(
        next.getUTCFullYear(),
        next.getUTCMonth(),
        next.getUTCDate(),
        schedule.endHour,
        schedule.endMinute,
        tz,
      );
    } else {
      endMs = epochMsForLocal(cy, cm0, cd, schedule.endHour, schedule.endMinute, tz);
    }
    const startWeekday = partsInTimezone(startMs, tz).weekday;
    if (!isWeekdayEnabled(schedule.daysMask, startWeekday)) return null;
    return { startMs, endMs };
  };

  let currentStart = null;
  let currentEnd = null;
  let nextStart = null;
  let nextEnd = null;

  // Look back up to 1 day (to catch a wrap that started yesterday) and
  // forward up to 8 days (full week + buffer for sparse day-masks).
  for (let offset = -1; offset <= 8; offset += 1) {
    const occ = occurrenceForOffset(offset);
    if (!occ) continue;
    if (occ.endMs <= nowMs) {
      // Elapsed window — keep tracking the most recent for ENDED grace.
      if (currentStart == null || occ.startMs > currentStart) {
        currentStart = occ.startMs;
        currentEnd = occ.endMs;
      }
      continue;
    }
    if (occ.startMs <= nowMs && occ.endMs > nowMs) {
      // Active window.
      currentStart = occ.startMs;
      currentEnd = occ.endMs;
      continue;
    }
    // Future window.
    if (nextStart == null || occ.startMs < nextStart) {
      nextStart = occ.startMs;
      nextEnd = occ.endMs;
    }
  }

  return { currentStart, currentEnd, nextStart, nextEnd };
}

/**
 * Format an epoch ms as a localised wall-clock time string in `tz`,
 * 12-hour with AM/PM, no zero-padded hour. e.g. "7:10 PM".
 *
 * @param {number} epochMs
 * @param {string} tz
 */
export function formatLocalAtTime(epochMs, tz) {
  const fmt = getFormatter(tz, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  // `en-GB` with `hour12:true` may return "7:10 pm" lowercase — normalise
  // to "7:10 PM" so the badge text matches the Lovable spec exactly.
  const raw = fmt.format(new Date(epochMs));
  return raw.replace(/\bam\b/i, 'AM').replace(/\bpm\b/i, 'PM');
}

/**
 * Returns true if two schedule windows are within `TRANSITION_MS` of a
 * boundary (start or end). Used to drive a brief crossfade.
 *
 * @param {{ start: number | null; end: number | null }} window
 * @param {number} nowMs
 */
export function isInTransition(window, nowMs) {
  if (window.start != null && Math.abs(nowMs - window.start) < TRANSITION_MS) return true;
  if (window.end != null && Math.abs(nowMs - window.end) < TRANSITION_MS) return true;
  return false;
}
