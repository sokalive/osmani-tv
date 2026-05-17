/**
 * Smoke tests for banner phase engine (run: node scripts/test-banner-phases.js)
 */
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'lib', 'normalizeBanner.js');
const src = fs.readFileSync(srcPath, 'utf8').replace(/^export /gm, '');
// eslint-disable-next-line no-eval
eval(`${src}\n//# sourceURL=normalizeBanner.js`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function atLocal(h, min, dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

const dailyRaw = {
  id: 10,
  useTimer: true,
  startTime: '22:00',
  endTime: '22:53',
  enableCountdown: false,
};

const slide = normalizeBanner(dailyRaw, 0);
assert(slide.hasDailyTimer, 'daily timer flag');
assert(isBannerVisibleAt(slide, atLocal(14, 0)), 'visible at 2pm');

const at2pm = getBannerRuntimeState(slide, atLocal(14, 0));
assert(at2pm?.statusLine.startsWith('COMING SOON'), '2pm COMING SOON');
assert(at2pm?.statusLine.includes('10:00 PM'), '2pm shows 10pm wall time');
assert(at2pm?.subtitleLine.includes('kuanza'), '2pm swahili kuanza');
assert(at2pm.remainingSec > 0, '2pm countdown positive');

const at10pm = getBannerRuntimeState(slide, atLocal(22, 0));
assert(at10pm?.statusLine === 'LIVE NOW', '10pm LIVE NOW');
assert(
  at10pm?.subtitleLine.includes('kuisha') || at10pm?.subtitleLine.includes('sasa hivi'),
  '10pm live swahili',
);

const at11pm = getBannerRuntimeState(slide, atLocal(23, 0));
assert(at11pm?.statusLine.startsWith('NEXT COMING SOON'), '11pm NEXT COMING SOON');
assert(at11pm?.subtitleLine.startsWith('Kesho saa'), '11pm kesho line');
assert(at11pm?.subtitleLine.includes('Usiku'), '11pm kesho usiku');

function wallAt(h, min) {
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d.getTime();
}
assert(formatSwahiliSaaWallTime(wallAt(22, 0)) === 'saa 4 Usiku', '10pm swahili');
assert(formatSwahiliSaaWallTime(wallAt(16, 0)) === 'saa 10 Mchana', '4pm swahili');
assert(formatSwahiliSaaWallTime(wallAt(8, 0)) === 'saa 2 Asubuhi', '8am swahili');
assert(formatSwahiliKeshoTime(wallAt(22, 0)).includes('Usiku'), 'kesho usiku');

assert(formatSwahiliRemaining(7200, 'kuanza') === 'Bado masaa 2 kuanza', '2 hours swahili');
assert(
  formatSwahiliRemaining(5400, 'kuanza') === 'Bado saa 1 na dakika 30 kuanza',
  '1h30 swahili',
);
assert(formatSwahiliRemaining(180, 'kuanza') === 'Bado dakika 3 kuanza', '3 min swahili');
assert(formatSwahiliRemaining(45, 'kuanza').includes('sekunde'), '45 sec swahili');
assert(formatSwahiliLiveSubtitle(3180).includes('dakika 53'), '53 min kuisha');
assert(formatSwahiliLiveSubtitle(60) === 'Inaendelea sasa hivi', 'live sasa hivi');
assert(formatCountdownClock(22 * 3600 + 51 * 60) === '22:51:00', 'padded hms countdown');

const eventRaw = {
  id: 99,
  enableCountdown: true,
  eventStart: new Date(atLocal(22, 0, 1)).toISOString(),
  eventEnd: new Date(atLocal(23, 0, 1)).toISOString(),
};
const eventSlide = normalizeBanner(eventRaw, 0);
assert(eventSlide.hasEventSchedule, 'event schedule');
const before = getBannerRuntimeState(eventSlide, atLocal(14, 0, 1));
assert(before?.statusLine.startsWith('COMING SOON'), 'event before');
assert(before?.subtitleLine.includes('kuanza'), 'event before swahili');
assert(!isBannerVisibleAt(eventSlide, atLocal(23, 30, 1)), 'hidden after event end');

const staticSlide = normalizeBanner({ id: 1, title: 'Static' }, 0);
assert(getBannerRuntimeState(staticSlide, Date.now()) == null, 'static no runtime');
assert(isBannerVisibleAt(staticSlide, Date.now()), 'static visible');

const countdownOnlyDaily = normalizeBanner(
  {
    id: 11,
    enableCountdown: true,
    enable_countdown: true,
    useTimer: false,
    event_timer: false,
    startTime: '22:00',
    endTime: '22:53',
  },
  0,
);
assert(countdownOnlyDaily.hasDailyTimer, 'countdown ON + daily window = daily timer');
assert(bannerShowsRuntimeUi(countdownOnlyDaily), 'countdown-only shows runtime UI');
const countdownRuntime = getBannerRuntimeState(countdownOnlyDaily, atLocal(14, 0));
assert(countdownRuntime?.statusLine.startsWith('COMING SOON'), 'countdown-only coming soon');

console.log('banner phase smoke tests: OK');
