/**
 * Pure timezone-aware time helpers for the banner engine.
 *
 * Default timezone is EAT (Africa/Dar_es_Salaam, UTC+3, no DST). Any
 * IANA timezone is supported through `Intl.DateTimeFormat` — formatters
 * are cached per (tz, options) pair so the 1Hz banner tick never
 * reallocates a `DateTimeFormat` instance.
 *
 * No I/O, no React, no AsyncStorage — these are deterministic functions
 * over `epochMs` and an IANA timezone string. Safe to unit-test under
 * Node ESM.
 */

export const EAT_TIMEZONE = 'Africa/Dar_es_Salaam';

const formatterCache = new Map();

function getFormatter(tz, options) {
  const key = `${tz}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...options });
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Wall-clock components in `tz` for an epoch ms. `month` is 1-indexed.
 * Hour normalised to 0..23 (en-GB sometimes returns "24" for midnight).
 *
 * @param {number} epochMs
 * @param {string} tz
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
export function getTzParts(epochMs, tz) {
  const fmt = getFormatter(tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  const out = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const p of parts) {
    switch (p.type) {
      case 'year': out.year = Number(p.value); break;
      case 'month': out.month = Number(p.value); break;
      case 'day': out.day = Number(p.value); break;
      case 'hour': out.hour = Number(p.value) % 24; break;
      case 'minute': out.minute = Number(p.value); break;
      case 'second': out.second = Number(p.value); break;
      default: break;
    }
  }
  return out;
}

/**
 * Timezone offset (ms east of UTC) for `epochMs` interpreted in `tz`.
 * Computes per-instant so it stays correct across DST boundaries; EAT
 * has no DST so the offset is a stable +10800000.
 *
 * @param {number} epochMs
 * @param {string} tz
 */
export function tzOffsetMs(epochMs, tz) {
  const p = getTzParts(epochMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - epochMs;
}

/**
 * Build the epoch ms for a wall-clock `(year, month1, day, hour, minute, second)`
 * interpreted in `tz`. Single-pass solve — exact for non-ambiguous civil
 * times. EAT has no DST so this is exact.
 *
 * `month1` is 1-indexed (1=January … 12=December).
 *
 * @param {number} year
 * @param {number} month1
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {number} second
 * @param {string} tz
 */
export function epochMsForLocal(year, month1, day, hour, minute, second, tz) {
  const naiveUtc = Date.UTC(year, month1 - 1, day, hour, minute, second);
  const offset = tzOffsetMs(naiveUtc, tz);
  return naiveUtc - offset;
}

/**
 * Extract the time-of-day portion (hour/minute/second) of an epoch ms or
 * ISO string when interpreted in `tz`. Returns null on invalid input.
 *
 * @param {string | number | null | undefined} input — epoch ms or ISO string
 * @param {string} tz
 * @returns {{ hour: number, minute: number, second: number } | null}
 */
export function getTimeOfDayInTz(input, tz) {
  let epochMs;
  if (typeof input === 'number' && Number.isFinite(input)) {
    epochMs = input;
  } else if (typeof input === 'string' && input.length > 0) {
    const t = Date.parse(input);
    if (!Number.isFinite(t)) return null;
    epochMs = t;
  } else {
    return null;
  }
  const p = getTzParts(epochMs, tz);
  return { hour: p.hour, minute: p.minute, second: p.second };
}

/**
 * Format an epoch ms as a 12-hour wall-clock time string in `tz`, e.g.
 * "7:10 PM". `en-GB` may return "7:10 pm" lowercase — normalised here.
 *
 * @param {number} epochMs
 * @param {string} tz
 */
export function formatClockInTz(epochMs, tz) {
  const fmt = getFormatter(tz, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const raw = fmt.format(new Date(epochMs));
  return raw.replace(/\bam\b/i, 'AM').replace(/\bpm\b/i, 'PM');
}

/**
 * Add `deltaDays` to a `(year, month1, day)` civil date. Pure UTC math
 * for the date math itself — only the wall-clock shift in `tz` is
 * delegated to `epochMsForLocal`. Returns the resulting `{ year, month1, day }`.
 *
 * @param {number} year
 * @param {number} month1
 * @param {number} day
 * @param {number} deltaDays
 */
export function addDaysInTz(year, month1, day, deltaDays) {
  const base = Date.UTC(year, month1 - 1, day);
  const next = new Date(base + deltaDays * 86400000);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}
