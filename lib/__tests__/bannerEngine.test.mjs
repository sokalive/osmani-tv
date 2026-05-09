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
  formatCountdownGap,
  formatSwahiliPost,
  formatSwahiliPre,
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

const cfg = mergeEngineConfig(null); // 360 / 15 / 5 / 5s / 3min / EAT

// -----------------------------------------------------------------------
// timeEat
// -----------------------------------------------------------------------
test('formatClockInTz: 19:10 EAT renders as 7:10 PM', () => {
  const ms = Date.UTC(2026, 4, 8, 16, 10, 0);
  assert.equal(formatClockInTz(ms, EAT_TIMEZONE), '7:10 PM');
});

test('getTimeOfDayInTz: extracts EAT time-of-day from UTC ISO', () => {
  const tod = getTimeOfDayInTz('2026-05-08T16:10:00Z', EAT_TIMEZONE);
  assert.deepEqual(tod, { hour: 19, minute: 10, second: 0 });
});

test('epochMsForLocal: round-trips through getTzParts in EAT', () => {
  const ms = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const parts = getTzParts(ms, EAT_TIMEZONE);
  assert.deepEqual(parts, { year: 2026, month: 5, day: 8, hour: 19, minute: 10, second: 0 });
});

// -----------------------------------------------------------------------
// formatters
// -----------------------------------------------------------------------
test('formatCountdownClock: 65s -> 1:05', () => {
  assert.equal(formatCountdownClock(65), '1:05');
});

test('formatCountdownClock: 3700s -> 1:01:40', () => {
  assert.equal(formatCountdownClock(3700), '1:01:40');
});

test('formatCountdownGap: under 1h -> M:SS', () => {
  assert.equal(formatCountdownGap(45 * 60 + 7), '45:07');
});

test('formatCountdownGap: 1h 28min -> 1:28', () => {
  assert.equal(formatCountdownGap(1 * 3600 + 28 * 60), '1:28');
});

test('formatCountdownGap: 23h 5min -> 23:05', () => {
  assert.equal(formatCountdownGap(23 * 3600 + 5 * 60), '23:05');
});

test('formatSwahiliPre: 3min -> "Bado dakika 3 kuanza"', () => {
  assert.equal(formatSwahiliPre(180), 'Bado dakika 3 kuanza');
});

test('formatSwahiliPre: 45s -> "Bado sekunde 45 kuanza"', () => {
  assert.equal(formatSwahiliPre(45), 'Bado sekunde 45 kuanza');
});

test('formatSwahiliPre: 100s rounds up -> "Bado dakika 2 kuanza"', () => {
  assert.equal(formatSwahiliPre(100), 'Bado dakika 2 kuanza');
});

test('formatSwahiliPost: 2min -> "Inaisha baada ya dakika 2"', () => {
  assert.equal(formatSwahiliPost(120), 'Inaisha baada ya dakika 2');
});

test('formatSwahiliPost: 30s -> "Inaisha sekunde 30"', () => {
  assert.equal(formatSwahiliPost(30), 'Inaisha sekunde 30');
});

// -----------------------------------------------------------------------
// mergeEngineConfig
// -----------------------------------------------------------------------
test('mergeEngineConfig: null -> defaults (3min ENDED grace)', () => {
  assert.deepEqual(mergeEngineConfig(null), { ...DEFAULT_ENGINE_CONFIG });
  assert.equal(DEFAULT_ENGINE_CONFIG.endedGraceMinutes, 3);
  assert.equal(DEFAULT_ENGINE_CONFIG.swahiliCountdownMinutes, 5);
});

test('mergeEngineConfig: snake_case input is mapped (incl. swahili)', () => {
  const merged = mergeEngineConfig({
    coming_next_window_minutes: 120,
    coming_soon_window_minutes: 10,
    swahili_countdown_minutes: 2,
    transition_seconds: 3,
    ended_grace_minutes: 7,
    default_timezone: 'Africa/Nairobi',
  });
  assert.equal(merged.comingNextWindowMinutes, 120);
  assert.equal(merged.comingSoonWindowMinutes, 10);
  assert.equal(merged.swahiliCountdownMinutes, 2);
  assert.equal(merged.transitionSeconds, 3);
  assert.equal(merged.endedGraceMinutes, 7);
  assert.equal(merged.defaultTimezone, 'Africa/Nairobi');
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

test('one-time NEXT_COMING_SOON when start is >6h away', () => {
  const start = 1_000_000_000_000 + 8 * 3600 * 1000;
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.NEXT_COMING_SOON);
});

test('one-time COMING_NEXT_AT inside 6h window', () => {
  const start = 1_000_000_000_000 + 5 * 3600 * 1000;
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.COMING_NEXT_AT);
});

test('one-time COMING_SOON inside last 15min, >5min before start', () => {
  const start = 1_000_000_000_000 + 10 * 60 * 1000;
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.COMING_SOON);
});

test('one-time SWAHILI_COUNTDOWN inside last 5min, >5s before start', () => {
  const start = 1_000_000_000_000 + 3 * 60 * 1000;
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.SWAHILI_COUNTDOWN);
});

test('one-time TRANSITION_PRE inside last 5s before start', () => {
  const start = 1_000_000_000_000 + 3 * 1000;
  const end = start + 3600 * 1000;
  const now = 1_000_000_000_000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.TRANSITION_PRE);
});

test('one-time LIVE_NOW between start and end-5s', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 1000;
  const end = now + 60 * 60 * 1000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.LIVE_NOW);
});

test('one-time TRANSITION_POST inside last 5s before end', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now + 3 * 1000;
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.TRANSITION_POST);
});

test('one-time ENDED inside 3min grace after end', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now - 60 * 1000; // ended 1min ago, within 3min grace
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.ENDED);
});

test('one-time NONE after ENDED grace expires (banner still rendered)', () => {
  const now = 1_000_000_000_000;
  const start = now - 2 * 60 * 60 * 1000;
  const end = now - 30 * 60 * 1000; // ended 30min ago > 3min grace
  const { state } = computeBannerState(oneTimeSlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.NONE);
});

// -----------------------------------------------------------------------
// State machine — daily repeat (auto Event Timer)
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
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8, 19, 30, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.LIVE_NOW);
  assert.equal(occurrence.startMs, start);
  assert.equal(occurrence.endMs, end);
});

test('daily NEXT_COMING_SOON in the morning (>6h before today\'s start)', () => {
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8,  9,  0, 0, EAT_TIMEZONE);
  const { state } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.NEXT_COMING_SOON);
});

test('daily COMING_NEXT_AT: 5h before today\'s start', () => {
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8, 14,  0, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.COMING_NEXT_AT);
  assert.equal(occurrence.startMs, start);
});

test('daily Event Timer: past 3min grace projects to tomorrow', () => {
  const startToday = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const endToday   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now        = epochMsForLocal(2026, 5, 8, 21,  0, 0, EAT_TIMEZONE); // 1h after end, way past 3min grace
  const startTomorrow = epochMsForLocal(2026, 5, 9, 19, 10, 0, EAT_TIMEZONE);
  const endTomorrow   = epochMsForLocal(2026, 5, 9, 20,  0, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(
    dailySlide(startToday, endToday),
    now,
    cfg,
  );
  // ~22h before tomorrow's start -> NEXT_COMING_SOON (state, not HIDDEN — banner stays visible)
  assert.equal(state, BANNER_STATES.NEXT_COMING_SOON);
  assert.equal(occurrence.startMs, startTomorrow);
  assert.equal(occurrence.endMs, endTomorrow);
});

test('daily ENDED grace: shows ENDED for 3min then transitions automatically', () => {
  const startToday = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const endToday   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  // 1min after end -> ENDED
  let now = endToday + 60 * 1000;
  let s = computeBannerState(dailySlide(startToday, endToday), now, cfg);
  assert.equal(s.state, BANNER_STATES.ENDED);
  // 4min after end -> past 3min grace, projected to tomorrow -> NEXT_COMING_SOON
  now = endToday + 4 * 60 * 1000;
  s = computeBannerState(dailySlide(startToday, endToday), now, cfg);
  assert.equal(s.state, BANNER_STATES.NEXT_COMING_SOON);
});

test('daily wraps across midnight (22:00 -> 02:00)', () => {
  const start = epochMsForLocal(2026, 5, 8, 22, 0, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8,  2, 0, 0, EAT_TIMEZONE); // earlier same day -> wrap
  const now   = epochMsForLocal(2026, 5, 8, 23, 30, 0, EAT_TIMEZONE);
  const { state, occurrence } = computeBannerState(dailySlide(start, end), now, cfg);
  assert.equal(state, BANNER_STATES.LIVE_NOW);
  const expectedEnd = epochMsForLocal(2026, 5, 9, 2, 0, 0, EAT_TIMEZONE);
  assert.equal(occurrence.endMs, expectedEnd);
});

// -----------------------------------------------------------------------
// View output — visibility ALWAYS true; engine drives badge only
// -----------------------------------------------------------------------
test('view: NEXT_COMING_SOON badge text + H:MM countdown', () => {
  const now = 1_000_000_000_000;
  // 7h 28min ahead -> outside the 6h COMING_NEXT_AT window -> NEXT_COMING_SOON
  const start = now + (7 * 3600 + 28 * 60) * 1000;
  const end = start + 3600 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.NEXT_COMING_SOON);
  assert.equal(view.badgeText, 'NEXT COMING SOON');
  assert.equal(view.countdownText, '7:28');
  assert.equal(view.visible, true);
});

test('view: COMING_NEXT_AT shows formatted clock in tz', () => {
  const start = epochMsForLocal(2026, 5, 8, 19, 10, 0, EAT_TIMEZONE);
  const end   = epochMsForLocal(2026, 5, 8, 20,  0, 0, EAT_TIMEZONE);
  const now   = epochMsForLocal(2026, 5, 8, 14,  0, 0, EAT_TIMEZONE);
  const view = computeBannerView(oneTimeSlide(start, end, EAT_TIMEZONE), now, cfg);
  assert.equal(view.state, BANNER_STATES.COMING_NEXT_AT);
  assert.equal(view.badgeText, 'COMING NEXT AT 7:10 PM');
  assert.equal(view.countdownText, null);
  assert.equal(view.visible, true);
});

test('view: COMING_SOON shows Swahili countdown line', () => {
  const now = 1_000_000_000_000;
  const start = now + 10 * 60 * 1000; // 10min ahead -> COMING_SOON
  const end = start + 3600 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.COMING_SOON);
  assert.equal(view.badgeText, 'COMING SOON');
  assert.equal(view.countdownText, 'Bado dakika 10 kuanza');
});

test('view: SWAHILI_COUNTDOWN promotes Swahili to badge text', () => {
  const now = 1_000_000_000_000;
  const start = now + 3 * 60 * 1000; // 3min ahead -> SWAHILI_COUNTDOWN
  const end = start + 3600 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.SWAHILI_COUNTDOWN);
  assert.equal(view.badgeText, 'Bado dakika 3 kuanza');
});

test('view: LIVE_NOW badge, no countdown when far from end', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 1000;
  const end = now + 2 * 60 * 60 * 1000; // 2h to go
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.LIVE_NOW);
  assert.equal(view.badgeText, 'LIVE NOW');
  assert.equal(view.badgeBlink, true);
  assert.equal(view.countdownText, null);
});

test('view: LIVE_NOW shows Swahili remaining when within last 30min', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now + 10 * 60 * 1000; // 10min remaining
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.LIVE_NOW);
  assert.equal(view.badgeText, 'LIVE NOW');
  assert.equal(view.countdownText, 'Inaisha baada ya dakika 10');
});

test('view: TRANSITION_POST shows Swahili ending + flash', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now + 4 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.TRANSITION_POST);
  assert.equal(view.badgeText, 'INAISHA SASA');
  assert.equal(view.countdownText, 'Inaisha sekunde 4');
  assert.equal(view.transitionFlash, true);
});

test('view: ENDED badge, no countdown, no flash', () => {
  const now = 1_000_000_000_000;
  const start = now - 60 * 60 * 1000;
  const end = now - 60 * 1000; // 1min ago, within 3min grace
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.ENDED);
  assert.equal(view.badgeText, 'ENDED');
  assert.equal(view.transitionFlash, false);
});

test('view: NONE for unscheduled banner — visible:true, no engine badge', () => {
  const now = 1_000_000_000_000;
  const slide = oneTimeSlide(null, null);
  const view = computeBannerView(slide, now, cfg);
  assert.equal(view.state, BANNER_STATES.NONE);
  assert.equal(view.visible, true);
  assert.equal(view.badgeText, '');
  assert.equal(view.badgeColor, null);
});

test('view: visibility is ALWAYS true regardless of state (no auto-hide)', () => {
  const now = 1_000_000_000_000;
  // Far future (>6h) — used to be HIDDEN, now NEXT_COMING_SOON, still visible
  const start = now + 24 * 3600 * 1000;
  const end = start + 3600 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.visible, true);
  assert.equal(view.state, BANNER_STATES.NEXT_COMING_SOON);
});

test('view: one-time past grace -> NONE (still visible, legacy fallback)', () => {
  const now = 1_000_000_000_000;
  const start = now - 2 * 60 * 60 * 1000;
  const end = now - 30 * 60 * 1000;
  const view = computeBannerView(oneTimeSlide(start, end), now, cfg);
  assert.equal(view.state, BANNER_STATES.NONE);
  assert.equal(view.visible, true);
  assert.equal(view.badgeText, '');
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
