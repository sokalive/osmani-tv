#!/usr/bin/env node
'use strict';

const { enrichBannerForViewer } = require('../lib/bannerViewerSerializer.shared.js');

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
  show_red_badge: true,
};

const out = enrichBannerForViewer(timerBanner);

assert('preserves timer fields', out.useTimer === true && out.event_timer === true);
assert('preserves show_red_badge', out.show_red_badge === true);
assert('preserves runtime position', out.runtime_position === 'bottom_left');
assert('preserves badge text', out.badge === '');

console.log('\n[verify-banner-viewer] done');
