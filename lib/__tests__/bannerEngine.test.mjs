/**
 * Unit tests for the Lovable banner engine. Run from repo root:
 *
 *   node lib/__tests__/bannerEngine.test.mjs
 *
 * Requires `lib/package.json` with `{"type":"module"}` so Node parses
 * the engine `.js` files as ESM (Metro/Babel ignore this marker — the
 * app bundle behaviour is unchanged).
 */

import assert from 'node:assert/strict';
import {
  BANNER_STATES,
  DEFAULT_ENGINE_CONFIG,
  computeBannerState,
  computeBannerView,
  formatCountdownClock,
  mergeEngineConfig,
} from '../bannerEngine.js';
import {
  EAT_TIMEZONE,
  epochMsForLocal,
  formatClockInTz,
  getTimeOfDayInTz,
  getTzParts,
} from '../timeEat.js';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok  ${t.name}`);
    } catch (e) {
      failed += 1;
      console.error(`  FAIL ${t.name}\n       ${e?.message ?? e}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passing`);
  if (failed > 0) process.exit(1);
}

const cfg = mergeEngineConfig(null); // defaults: 360 / 15 / 5 / 5 / EAT

// -----------------------------------------------------------------------
// timeEat
// -----------------------------------------------------------------------
test('formatClockInTz: 19:10 EAT renders as 7:10 PM', () => {
  // 2026-05-08 19:10:00 EAT = 16:10:00 UTC
  const ms = Date.UTC(2026, 4, 8, 16, 10, 0);
  assert.equal(formatClockInTz(ms, EAT_TIMEZONE), '7:10 PM');
});

test('getTimeOfDayInTz: extracts EAT time-of-day from UTC ISO', () => {
  // 16:10:00 UTC == 19:10:00 EAT
  const tod = getTimeOfDayInTz('2026-05-08T16:10:00Z', EAT_TIMEZONE);
  assert.deepEqual(tod, { hour: 19, minute: 10, second: 0 });
});

test('epochMsForLocal: round-trips through getTzParts in EAT', () => {
  const ms = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const parts = getTzParts(ms, EAT_TIMEZONE);
  assert.deepEqual(parts, { year: 2026, month: 5, day: 8, hour: 19, minute: 10, second: 0 });
});

// -----------------------------------------------------------------------
// formatCountdownClock
// -----------------------------------------------------------------------
test('formatCountdownClock: 65s -> 1:05', () => {
  assert.equal(formatCountdownClock(65), '1:05');
});

test('formatCountdownClock: 3700s -> 1:01:40', () => {
  assert.equal(formatCountdownClock(3700), '1:01:40');
});

test('formatCountdownClock: clamps negatives to 0:00', () => {
  assert.equal(formatCountdownClock(-30), '0:00');
});

// -----------------------------------------------------------------------
// mergeEngineConfig
// -----------------------------------------------------------------------
test('mergeEngineConfig: null -> defaults', () => {
  assert.deepEqual(mergeEngineConfig(null), { ...DEFAULT_ENGINE_CONFIG });
});

test('mergeEngineConfig: snake_case input is mapped', () => {
  const merged = mergeEngineConfig({
    coming_next_window_minutes: 120,
    coming_soon_window_minutes: 10,
    transition_seconds: 3,
    ended_grace_minutes: 7,
    default_timezone: 'Africa/Nairobi',
  });
  assert.equal(merged.comingNextWindowMinutes, 120);
  assert.equal(merged.comingSoonWindowMinutes, 10);
  assert.equal(merged.transitionSeconds, 3);
  assert.equal(merged.endedGraceMinutes, 7);
  assert.equal(merged.defaultTimezone, 'Africa/Nairobi');
});

test('mergeEngineConfig: invalid values fall back to defaults', () => {
  const merged = mergeEngineConfig({
    coming_soon_window_minutes: 'abc',
    transition_seconds: -2,
    default_timezone: '   ',
  });
  assert.equal(merged.comingSoonWindowMinutes, DEFAULT_ENGINE_CONFIG.comingSoonWindowMinutes);
  assert.equal(merged.transitionSeconds, DEFAULT_ENGINE_CONFIG.transitionSeconds);
  assert.equal(merged.defaultTimezone, DEFAULT_ENGINE_CONFIG.defaultTimezone);
});

// -----------------------------------------------------------------------
// State machine — one-time schedule
// -----------------------------------------------------------------------
function oneTimeSlide(startMs, endMs, tz = null) {
  return {
    id: 'one',
    title: 't',
    description: '',
    imageUrl: '',
    isActive: true,
    eventStart: startMs,
    eventEnd: endMs,
    repeatMode: 'none',
    timezone: tz,
    legacyBadgeEnabled: false,
    legacyBadgeBlink: false,
    legacyBadgeColor: '#DC2626',
    legacyBadgeText: '',
    legacyBadgeColorOverride: null,
  };
}

test('one-time HIDDEN before COMING_NEXT window (>6h to start)', () => {
  const start = 1_000_000_000_000 + 8 * 3600 * 1000; // 8h ahead
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.HIDDEN);
});

test('one-time COMING_NEXT inside 6h window', () => {
  const start = 1_000_000_000_000 + 5 * 3600 * 1000; // 5h ahead
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.COMING_NEXT);
});

test('one-time COMING_SOON inside last 15min before start', () => {
  const start = 1_000_000_000_000 + 10 * 60 * 1000; // 10min ahead
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.COMING_SOON);
});

test('one-time TRANSITION_PRE inside last 5s before start', () => {
  const start = 1_000_000_000_000 + 3 * 1000; // 3s ahead
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.TRANSITION_PRE);
});

test('one-time LIVE_NOW between start and end-5s', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 1000;             // 1min ago
  const end = now + 60 * 60 * 1000;          // 1h ahead
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.LIVE_NOW);
});

test('one-time TRANSITION_POST inside last 5s before end', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;        // 1h ago
  const end = now + 3 * 1000;                // 3s ahead
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.TRANSITION_POST);
});

test('one-time ENDED inside 5min grace after end', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now - 60 * 1000;               // ended 1min ago
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.ENDED);
});

test('one-time HIDDEN after ENDED grace expires', () => {
  const now = 1_000_000_000_000;
  const start = now - 2 * 60 * 60 * 1000;
  const end = now - 30 * 60 * 1000;          // ended 30min ago (>5min grace)
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.HIDDEN);
});

// -----------------------------------------------------------------------
// State machine — daily repeat
// -----------------------------------------------------------------------
function dailySlide(startMs, endMs, tz = EAT_TIMEZONE) {
  return {
    id: 'daily',
    title: 't',
    description: '',
    imageUrl: '',
    isActive: true,
    eventStart: startMs,
    eventEnd: endMs,
    repeatMode: 'daily',
    timezone: tz,
    legacyBadgeEnabled: false,
    legacyBadgeBlink: false,
    legacyBadgeColor: '#DC2626',
    legacyBadgeText: '',
    legacyBadgeColorOverride: null,
  };
}

test('daily LIVE_NOW: now is mid-window today', () => {
  // Anchor "today" in EAT: 2026-05-08 19:10:00 EAT (start), 20:00:00 EAT (end)
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8, 19, 30, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.LIVE_NOW);
  assert.equal(occurrence.startMs, start);
  assert.equal(occurrence.endMs, end);
});

test('daily COMING_NEXT: morning before 6h window', () => {
  // Window 19:10 - 20:00 EAT, "now" is 09:00 EAT (10h ahead) -> HIDDEN
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8,  9,  0, 0, EAT_TIMEZONE);
  const { state } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.HIDDEN);
});

test('daily COMING_NEXT: 5h before today\'s start', () => {
  // 14:00 EAT, start 19:10 EAT -> 5h10m ahead -> COMING_NEXT
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8, 14,  0, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.COMING_NEXT);
  assert.equal(occurrence.startMs, start);
});

test('daily: past today\'s grace projects to tomorrow', () => {
  // Window 19:10 - 20:00 EAT today (May 8). "now" is 21:00 EAT (1h after end,
  // grace=5min => past grace). Engine should advance to tomorrow May 9.
  const startToday = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const endToday   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now        = epochMsForLocal(2026, 5, 8, 21,  0, 0, EAT_TIMEZONE);
  const startTomorrow = epochMsForLocal(2026, 5, 9, 19, 10, 0, EAT_TIMEZONE);
  const endTomorrow   = epochMsForLocal(2026, 5, 9, 20,  0, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(
    dailySlide(startToday, endToday),
    now,
    cfg,
  );
  // 22h before tomorrow's start => HIDDEN (>6h)
  assert.equal(state, BANNER_STATES.HIDDEN);
  assert.equal(occurrence.startMs, startTomorrow);
  assert.equal(occurrence.endMs, endTomorrow);
});

test('daily: window wraps across midnight (22:00 -> 02:00)', () => {
  // Anchor row at 22:00 - 02:00 EAT. At 23:30 EAT same day, must be LIVE_NOW.
  const start = epochMsForLocal(2026, 5, 8, 22, 0, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8,  2, 0, 0, EAT_TIMEZONE); // earlier than start -> wrap
  const now   = epochMsForLocal(2026, 5, 8, 23, 30, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.LIVE_NOW);
  // End should be the *next* day's 02:00 EAT
  const expectedEnd = epochMsForLocal(2026, 5, 9, 2, 0, 0, EAT_TIMEZONE);
  assert.equal(occurrence.endMs, expectedEnd);
});

// -----------------------------------------------------------------------
// View output
// -----------------------------------------------------------------------
test('view: COMING_NEXT badge text uses formatted clock in tz', () => {
  // 19:10 EAT start; now = 14:00 EAT (5h10m ahead) -> COMING_NEXT
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8, 14,  0, 0, EAT_TIMEZONE);
  const view = computeBannerView(oneTimeSlide(start, end, EAT_TIMEZONE), now, cfg);
  assert.equal(view.state, BANNER_STATES.COMING_NEXT);
  assert.equal(view.badgeText, 'COMING NEXT AT 7:10 PM');
  assert.equal(view.countdownText, null);
  assert.equal(view.visible, true);
});

test('view: COMING_SOON shows STARTS IN countdown', () => {
  const now = 1_000_000_000_000;
  const start = now + 5 * 60 * 1000; // 5min ahead
  const end = start + 3600 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.COMING_SOON);
  assert.equal(view.badgeText, 'COMING SOON');
  assert.equal(view.countdownText, 'STARTS IN 5:00');
});

test('view: LIVE_NOW badge, no countdown, blink=true', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 1000;
  const end = now + 30 * 60 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.LIVE_NOW);
  assert.equal(view.badgeText, 'LIVE NOW');
  assert.equal(view.badgeBlink, true);
  assert.equal(view.countdownText, null);
});

test('view: TRANSITION_POST shows ENDS IN countdown and flash', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now + 4 * 1000; // 4s left
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.TRANSITION_POST);
  assert.equal(view.badgeText, 'ENDING SOON');
  assert.equal(view.countdownText, 'ENDS IN 0:04');
  assert.equal(view.transitionFlash, true);
});

test('view: ENDED badge, no countdown, no flash', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now - 60 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.ENDED);
  assert.equal(view.badgeText, 'ENDED');
  assert.equal(view.transitionFlash, false);
});

test('view: unscheduled (no event_*) -> NONE, visible=true, empty engine badge', () => {
  const now = 1_000_000_000_000;
  const slide = oneTimeSlide(null, null);
  const view = computeBannerView(slide, now, cfg);
  assert.equal(view.state, BANNER_STATES.NONE);
  assert.equal(view.visible, true);
  assert.equal(view.badgeText, '');
  assert.equal(view.badgeColor, null);
});

test('view: HIDDEN -> visible=false', () => {
  const now = 1_000_000_000_000;
  const start = now + 24 * 3600 * 1000; // 24h ahead, well outside any window
  const end = start + 3600 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.HIDDEN);
  assert.equal(view.visible, false);
});

test('view: legacyBadgeColorOverride wins for engine-driven states', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 1000;
  const end = now + 30 * 60 * 1000;
  const slide = { ...oneTimeSlide(start, end), legacyBadgeColorOverride: '#123ABC' };
  const view = computeBannerView(slide, now, cfg);
  assert.equal(view.state, BANNER_STATES.LIVE_NOW);
  assert.equal(view.badgeColor, '#123ABC');
});

run();
