#!/usr/bin/env node
'use strict';

const { enrichBannerForViewer } = require('../backend/lib/bannerViewerSerializer');

function assert(label, cond) {
  if (!cond) {
    console.error('FAIL:', label);
    process.exitCode = 1;
    return;
  }
  console.log('PASS:', label);
}

const timerBanner = {
  id: 7,
  title: 'NBC Premier League',
  useTimer: true,
  event_timer: true,
  startTime: '16:00',
  endTime: '20:00',
  badge_enabled: true,
  badge: '',
  runtime_position: 'bottom_left',
};

const out = enrichBannerForViewer(timerBanner);

assert('timer flags stripped', out.useTimer === false && out.event_timer === false);
assert('badge text from timer fallback', out.badge === 'LIVE NOW');
assert('badge color red', out.badge_color === '#DC2626');
assert('badge position top_left', out.badge_position === 'top_left');

console.log('\n[verify-banner-viewer] done');
