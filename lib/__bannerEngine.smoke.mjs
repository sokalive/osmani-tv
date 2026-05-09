/**
 * Standalone smoke-check for the Lovable banner engine. Run with:
 *
 *   node lib/__bannerEngine.smoke.mjs
 *
 * Prints PASS/FAIL per case. Not part of the app bundle. Kept in `lib/`
 * (not `__tests__`) because this repo has no Jest setup; this file only
 * imports pure ES modules from `bannerSchedule.js` + `normalizeBanner.js`.
 */
import {
  DEFAULT_TIMEZONE,
  formatLocalAtTime,
  parseLocalTime,
  resolveDailyWindow,
  isWeekdayEnabled,
  partsInTimezone,
  epochMsForLocal,
} from './bannerSchedule.js';
import {
  computeBannerState,
  getAutoBadge,
  getCountdownState,
  isBannerVisibleAt,
  normalizeBanner,
} from './normalizeBanner.js';

let pass = 0;
let fail = 0;

function assert(label, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? `  →  ${JSON.stringify(detail)}` : ''}`);
  }
}

function group(name, fn) {
  console.log(`\n[${name}]`);
  fn();
}

// ---------- helpers ----------

const EAT = DEFAULT_TIMEZONE;

group('parseLocalTime', () => {
  assert('valid HH:MM', JSON.stringify(parseLocalTime('07:10')) === JSON.stringify({ hour: 7, minute: 10 }));
  assert('valid H:MM', JSON.stringify(parseLocalTime('7:05')) === JSON.stringify({ hour: 7, minute: 5 }));
  assert('rejects 24:00', parseLocalTime('24:00') === null);
  assert('rejects garbage', parseLocalTime('abc') === null);
  assert('rejects null', parseLocalTime(null) === null);
});

group('isWeekdayEnabled (mask 127 = all days)', () => {
  for (let d = 0; d < 7; d += 1) {
    assert(`day ${d} enabled in 127`, isWeekdayEnabled(127, d) === true);
  }
  assert('day 0 (Sun) disabled in mask 0b1111110', isWeekdayEnabled(0b1111110, 0) === false);
  assert('day 6 (Sat) enabled in mask 0b1000000', isWeekdayEnabled(0b1000000, 6) === true);
});

group('partsInTimezone EAT (UTC+3)', () => {
  // 2026-01-01 12:00:00 UTC === 15:00 EAT.
  const t = Date.UTC(2026, 0, 1, 12, 0, 0);
  const p = partsInTimezone(t, EAT);
  assert('hour=15', p.hour === 15);
  assert('day=1', p.day === 1);
  assert('weekday=Thu(4)', p.weekday === 4);
});

group('epochMsForLocal EAT round-trip', () => {
  // 2026-05-08 19:10 EAT → 16:10 UTC.
  const t = epochMsForLocal(2026, 4, 8, 19, 10, EAT);
  assert('matches 16:10 UTC', new Date(t).toISOString() === '2026-05-08T16:10:00.000Z',
    new Date(t).toISOString());
});

group('formatLocalAtTime', () => {
  // 2026-05-08 19:10 EAT
  const t = epochMsForLocal(2026, 4, 8, 19, 10, EAT);
  const s = formatLocalAtTime(t, EAT);
  assert('renders 7:10 PM', s === '7:10 PM', s);
});

group('resolveDailyWindow (no wrap, EAT 19:10–21:00, mask 127)', () => {
  // "now" = 2026-05-08 18:00 EAT (one hour before today's start).
  const now = epochMsForLocal(2026, 4, 8, 18, 0, EAT);
  const w = resolveDailyWindow({
    startHour: 19, startMinute: 10, endHour: 21, endMinute: 0, daysMask: 127,
  }, now, EAT);
  // `current*` may legitimately point to yesterday's elapsed window so
  // ENDED grace can fire when applicable. The state machine above gates
  // the badge on `nowMs - currentEnd <= ENDED_GRACE_MS`.
  assert('current points to a past day or null',
    w.currentStart === null || w.currentStart < now);
  assert('next ≈ 19:10 EAT today', new Date(w.nextStart).toISOString() === '2026-05-08T16:10:00.000Z',
    new Date(w.nextStart).toISOString());
  assert('next end ≈ 21:00 EAT today', new Date(w.nextEnd).toISOString() === '2026-05-08T18:00:00.000Z',
    new Date(w.nextEnd).toISOString());
});

group('resolveDailyWindow (active live window)', () => {
  // "now" = 2026-05-08 19:30 EAT, schedule 19:10-21:00.
  const now = epochMsForLocal(2026, 4, 8, 19, 30, EAT);
  const w = resolveDailyWindow({
    startHour: 19, startMinute: 10, endHour: 21, endMinute: 0, daysMask: 127,
  }, now, EAT);
  assert('current is set during live', w.currentStart !== null && w.currentEnd !== null);
  assert('next is tomorrow', w.nextStart !== null && w.nextStart > w.currentEnd);
});

group('resolveDailyWindow (wrap across midnight 22:00–02:00)', () => {
  // "now" = 2026-05-09 01:00 EAT, schedule 22:00-02:00 daily.
  const now = epochMsForLocal(2026, 4, 9, 1, 0, EAT);
  const w = resolveDailyWindow({
    startHour: 22, startMinute: 0, endHour: 2, endMinute: 0, daysMask: 127,
  }, now, EAT);
  assert('currentStart = yesterday 22:00 EAT',
    new Date(w.currentStart).toISOString() === '2026-05-08T19:00:00.000Z',
    new Date(w.currentStart).toISOString());
  assert('currentEnd = today 02:00 EAT',
    new Date(w.currentEnd).toISOString() === '2026-05-08T23:00:00.000Z',
    new Date(w.currentEnd).toISOString());
});

group('resolveDailyWindow (mask skips today)', () => {
  // "now" = 2026-05-08 (Friday) 18:00 EAT, mask = Sat only (bit 6 = 64).
  const now = epochMsForLocal(2026, 4, 8, 18, 0, EAT);
  const w = resolveDailyWindow({
    startHour: 19, startMinute: 10, endHour: 21, endMinute: 0, daysMask: 64,
  }, now, EAT);
  assert('current null (Fri disabled)', w.currentStart === null);
  // 2026-05-09 is Saturday in EAT.
  assert('next is Saturday',
    partsInTimezone(w.nextStart, EAT).weekday === 6);
});

group('computeBannerState — daily LIVE NOW', () => {
  const now = epochMsForLocal(2026, 4, 8, 19, 30, EAT);
  const slide = normalizeBanner({
    id: 'b1',
    title: 't',
    image_url: 'https://x',
    is_active: true,
    schedule_kind: 'daily',
    daily_start_local: '19:10',
    daily_end_local: '21:00',
    daily_days_mask: 127,
    schedule_timezone: EAT,
  }, 0);
  const c = computeBannerState(slide, now);
  assert('state=LIVE', c.state === 'LIVE');
  const badge = getAutoBadge(slide, c);
  assert('badge text = LIVE NOW', badge.text === 'LIVE NOW');
  assert('badge blinks', badge.blink === true);
  const cd = getCountdownState(slide, now, c);
  assert('countdown is ENDS IN', cd && cd.prefix === 'ENDS IN');
});

group('computeBannerState — COMING SOON (10 min before)', () => {
  const now = epochMsForLocal(2026, 4, 8, 19, 0, EAT);
  const slide = normalizeBanner({
    id: 'b2',
    title: 't',
    image_url: 'https://x',
    is_active: true,
    schedule_kind: 'daily',
    daily_start_local: '19:10',
    daily_end_local: '21:00',
  }, 0);
  const c = computeBannerState(slide, now);
  assert('state=COMING_SOON', c.state === 'COMING_SOON');
  const badge = getAutoBadge(slide, c);
  assert('badge=COMING SOON', badge.text === 'COMING SOON');
});

group('computeBannerState — COMING NEXT AT 7:10 PM (3h before)', () => {
  const now = epochMsForLocal(2026, 4, 8, 16, 10, EAT);
  const slide = normalizeBanner({
    id: 'b3',
    title: 't',
    image_url: 'https://x',
    is_active: true,
    schedule_kind: 'daily',
    daily_start_local: '19:10',
    daily_end_local: '21:00',
  }, 0);
  const c = computeBannerState(slide, now);
  assert('state=COMING_NEXT', c.state === 'COMING_NEXT');
  const badge = getAutoBadge(slide, c);
  assert('badge text formatted', badge.text === 'COMING NEXT AT 7:10 PM', badge.text);
});

group('computeBannerState — ENDED grace + visibility flips after grace', () => {
  const slide = normalizeBanner({
    id: 'b4',
    title: 't',
    image_url: 'https://x',
    is_active: true,
    schedule_kind: 'daily',
    daily_start_local: '19:10',
    daily_end_local: '21:00',
  }, 0);
  // 5 minutes after end → ENDED, visible.
  const within = epochMsForLocal(2026, 4, 8, 21, 5, EAT);
  const c1 = computeBannerState(slide, within);
  assert('state=ENDED inside grace', c1.state === 'ENDED');
  assert('visible inside grace', isBannerVisibleAt(slide, within) === true);
  // 30 minutes after end → past 15 min grace → IDLE / hidden (next is tomorrow > 6h away).
  const after = epochMsForLocal(2026, 4, 8, 21, 30, EAT);
  const c2 = computeBannerState(slide, after);
  assert('state=IDLE after grace', c2.state === 'IDLE');
  assert('hidden after grace', isBannerVisibleAt(slide, after) === false);
});

group('computeBannerState — one-time event', () => {
  const start = '2026-05-08T19:10:00+03:00';
  const end = '2026-05-08T21:00:00+03:00';
  const slide = normalizeBanner({
    id: 'b5',
    title: 't',
    image_url: 'https://x',
    is_active: true,
    schedule_kind: 'one_time',
    event_start: start,
    event_end: end,
  }, 0);
  const live = epochMsForLocal(2026, 4, 8, 20, 0, EAT);
  assert('LIVE during one-time window', computeBannerState(slide, live).state === 'LIVE');
  const before = epochMsForLocal(2026, 4, 8, 19, 0, EAT);
  assert('COMING_SOON 10 min before one-time', computeBannerState(slide, before).state === 'COMING_SOON');
});

group('computeBannerState — no schedule + admin override stays', () => {
  const slide = normalizeBanner({
    id: 'b6',
    title: 't',
    image_url: 'https://x',
    is_active: true,
    badge: 'BURE',
    badge_enabled: true,
    badge_color: '#1EC967',
    badge_blink: false,
  }, 0);
  const c = computeBannerState(slide, Date.now());
  assert('state=NONE without schedule', c.state === 'NONE');
  const badge = getAutoBadge(slide, c);
  assert('admin badge preserved', badge.enabled && badge.text === 'BURE' && badge.color === '#1EC967');
  assert('always visible without schedule', isBannerVisibleAt(slide, Date.now()) === true);
});

console.log(`\n--- ${pass} pass / ${fail} fail ---`);
if (fail > 0) process.exit(1);
