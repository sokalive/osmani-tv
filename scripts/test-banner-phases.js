/**
 * Smoke tests + live API payload inspection (run: node scripts/test-banner-phases.js)
 */
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'lib', 'normalizeBanner.js');
let src = fs.readFileSync(srcPath, 'utf8');
src = src.replace(/^import .*$/gm, '').replace(/^export /gm, '');

function enrichBannerForViewer(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row };
}

function resolveMediaAssetUrl(url) {
  return url;
}

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
assert(at2pm?.phase === 'coming', '2pm far coming phase');
assert(at2pm?.subtitleLine === '', 'no subtitle line');
assert(at2pm.remainingSec > 0, '2pm countdown positive');

const at7pm = getBannerRuntimeState(slide, atLocal(19, 0));
assert(at7pm?.statusLine === 'BADO MASAA 3 KUANZA', '7pm swahili hours countdown');
assert(at7pm?.phase === 'coming_near', '7pm near phase');

const at955pm = getBannerRuntimeState(slide, atLocal(21, 55));
assert(at955pm?.statusLine === 'BADO DAKIKA 5 KUANZA', '955pm swahili minutes countdown');

const at10pm = getBannerRuntimeState(slide, atLocal(22, 0));
assert(at10pm?.statusLine === 'LIVE NOW', '10pm LIVE NOW');
assert(at10pm?.phase === 'live', '10pm live phase');
assert(at10pm?.pulse === true, 'live pulse enabled');

const at1054pm = getBannerRuntimeState(slide, atLocal(22, 54));
assert(at1054pm?.statusLine === 'END', '1 min after end shows END');
assert(at1054pm?.phase === 'end', 'end phase');

const at1057pm = getBannerRuntimeState(slide, atLocal(22, 57));
assert(at1057pm?.statusLine.startsWith('NEXT TODAY'), 'after end window NEXT TODAY');
assert(at1057pm?.statusLine.includes('10:00 PM'), 'next today shows slot time');
assert(at1057pm?.phase === 'next_today', 'next_today phase');

const at11pm = getBannerRuntimeState(slide, atLocal(23, 0));
assert(at11pm?.statusLine.startsWith('NEXT TODAY'), '11pm NEXT TODAY same day');

const at1am = getBannerRuntimeState(slide, atLocal(1, 0, 1));
assert(at1am?.statusLine.startsWith('COMING SOON'), '1am reset COMING SOON');
assert(at1am?.statusLine.includes('10:00 PM'), '1am shows tonight slot');

assert(
  formatPreStartStatusLine(8 * 3600, atLocal(22, 0)) === 'COMING SOON 10:00 PM',
  'formatPreStart far english',
);
assert(formatPreStartStatusLine(3 * 3600, atLocal(22, 0)) === 'BADO MASAA 3 KUANZA', 'formatPreStart hours');
assert(formatPreStartStatusLine(5 * 60, atLocal(22, 0)) === 'BADO DAKIKA 5 KUANZA', 'formatPreStart minutes');

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

function wallAt(h, min) {
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d.getTime();
}
assert(formatSwahiliSaaWallTime(wallAt(22, 0)) === 'saa 4 Usiku', '10pm swahili');
assert(formatSwahiliSaaWallTime(wallAt(16, 0)) === 'saa 10 Mchana', '4pm swahili');
assert(formatSwahiliSaaWallTime(wallAt(8, 0)) === 'saa 2 Asubuhi', '8am swahili');

const stringFalseTimer = normalizeBanner(
  { id: 's', useTimer: 'false', event_timer: 'true', startTime: '22:00', endTime: '22:53' },
  0,
);
assert(stringFalseTimer.hasDailyTimer, 'string false useTimer + event_timer true');

const stringTrueCountdown = normalizeBanner(
  { id: 'c', enableCountdown: 'true', useTimer: 'false', startTime: '22:00', endTime: '22:53' },
  0,
);
assert(stringTrueCountdown.hasDailyTimer, 'string true enableCountdown');

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
assert(isBannerVisibleAt(eventSlide, atLocal(23, 10, 1)), 'visible after event end same day');
assert(!isBannerVisibleAt(eventSlide, atLocal(23, 10, 2)), 'hidden after midnight rollover');

const staticSlide = normalizeBanner({ id: 1, title: 'Static' }, 0);
assert(getBannerRuntimeState(staticSlide, Date.now()) == null, 'static no runtime');

const countdownOnlyDaily = normalizeBanner(
  {
    id: 11,
    enableCountdown: true,
    useTimer: false,
    event_timer: false,
    startTime: '22:00',
    endTime: '22:53',
  },
  0,
);
assert(countdownOnlyDaily.hasDailyTimer, 'countdown ON + daily window');
assert(getBannerRuntimeState(countdownOnlyDaily, atLocal(14, 0)) != null, 'countdown-only runtime');

const showRedApiDaily = normalizeBanner(
  {
    id: 7,
    useTimer: false,
    event_timer: false,
    show_red_badge: true,
    startTime: '16:00',
    endTime: '20:00',
    runtime_position: 'bottom_left',
  },
  0,
);
assert(showRedApiDaily.hasDailyTimer, 'show_red_badge + daily window');
assert(showRedApiDaily.runtimePosition === 'bottom_left', 'show_red_badge preserves position');
assert(getBannerRuntimeState(showRedApiDaily, atLocal(14, 0)) != null, 'show_red_badge runtime');

const eventTimerOnly = normalizeBanner(
  {
    id: 100,
    event_timer: true,
    show_red_badge: true,
    eventStart: new Date(atLocal(22, 0, 2)).toISOString(),
    eventEnd: new Date(atLocal(23, 0, 2)).toISOString(),
  },
  0,
);
assert(eventTimerOnly.hasEventSchedule, 'event_timer + show_red_badge schedule');

assert(parseRuntimePosition({ runtime_position: 'bottom_left' }) === 'bottom_left');
assert(parseRuntimePosition({ runtimePosition: 'top-right' }) === 'top_right');
assert(parseRuntimePosition({ runtime_position: 'top left' }) === 'top_left', 'space separated');
assert(parseRuntimePosition({ runtime_position: 'invalid' }) === 'center');
assert(parseRuntimePosition({}) === 'center', 'default runtime position');
assert(
  parseRuntimePosition({ runtime_position: '' }) === 'center',
  'empty string uses center',
);

const positioned = normalizeBanner(
  { id: 12, useTimer: true, startTime: '22:00', endTime: '22:53', runtime_position: 'top_right' },
  0,
);
assert(positioned.runtimePosition === 'top_right', 'runtime_position normalized');

async function inspectLiveApi() {
  const res = await fetch('https://osmani-admin-api.onrender.com/api/banners');
  const banners = await res.json();
  console.log('\n--- LIVE /api/banners runtime inspection ---');
  banners.forEach((raw, i) => {
    const diag = inspectBannerRuntime(raw, i);
    console.log(JSON.stringify(diag, null, 2));
    if (diag.title === 'The Ottoman') {
      assert(diag.normalized.hasDailyTimer, 'live Ottoman hasDailyTimer');
      assert(diag.runtime != null, 'live Ottoman runtime');
    }
    if (diag.title === 'Woman') {
      assert(!diag.normalized.hasDailyTimer, 'live Woman static');
      assert(diag.runtime == null, 'live Woman no runtime');
    }
  });
}

inspectLiveApi()
  .then(() => {
    console.log('\nbanner phase smoke tests: OK');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
