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
assert(at2pm.remainingSec > 0, '2pm countdown positive');

const at10pm = getBannerRuntimeState(slide, atLocal(22, 0));
assert(at2pm?.statusLine !== at10pm?.statusLine, 'phase changes');
assert(at10pm?.statusLine === 'LIVE NOW', '10pm LIVE NOW');

const at11pm = getBannerRuntimeState(slide, atLocal(23, 0));
assert(at11pm?.statusLine.startsWith('NEXT COMING SOON'), '11pm NEXT COMING SOON');
assert(at11pm?.statusLine.includes('10:00 PM'), '11pm next 10pm');

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
assert(!isBannerVisibleAt(eventSlide, atLocal(23, 30, 1)), 'hidden after event end');

const staticSlide = normalizeBanner({ id: 1, title: 'Static' }, 0);
assert(getBannerRuntimeState(staticSlide, Date.now()) == null, 'static no runtime');
assert(isBannerVisibleAt(staticSlide, Date.now()), 'static visible');

console.log('banner phase smoke tests: OK');
